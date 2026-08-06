import { randomBytes } from "node:crypto";
import { hash as hashPassword, verify as verifyPasswordHash } from "@node-rs/argon2";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import * as OTPAuth from "otpauth";
import { AppError } from "../../common/errors.js";
import { newUuid } from "../../common/id.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../db/types.js";
import { appendAuditEvent } from "../platform/audit.js";
import type {
  AdminOperationResult,
  AdminSessionListQuery,
  ApprovalListQuery,
  ChangePasswordInput,
  ConfirmTotpInput,
  CredentialTokenInput,
  DecideApprovalInput,
  EffectiveAccessPreview,
  EffectiveRoleAssignment,
  InviteUserInput,
  MfaChallengeInput,
  RecoverMfaInput,
  RequestContext,
  RoleChangeInput,
  RolePreviewInput,
  UserListQuery,
  VersionedReasonInput,
} from "./admin-contracts.js";
import {
  approvalPayloadHash,
  assertFreshMfa,
  assertNoSelf,
  assertPasswordPolicy,
  effectiveAccessFingerprint,
  hasPrivilegedRole,
  IDENTITY_POLICY_VERSION,
} from "./admin-policy.js";
import {
  approvableRoleOperationIds,
  ROLE_PREVIEW_OPERATION,
  type RoleOperationDefinition,
  type RoleOperationKey,
  type RoleScopeType,
  roleOperation,
  roleOperationByOperationId,
} from "./admin-role-registry.js";
import { deriveCredentialToken as deriveCredentialDeliveryToken } from "./credential-delivery/contracts.js";
import { decryptSecret, encryptSecret, keyedHash, secureHashEquals } from "./crypto.js";
import {
  type AuthContext,
  adminSessionCursorSigningKey,
  type IdentityService,
  type SessionReceipt,
} from "./service.js";
import type { AdminIdentitySessionItem } from "./session-contracts.js";

const ARGON_OPTIONS = {
  algorithm: 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;
const INVITE_TTL_MS = 48 * 60 * 60_000;
const RESET_TTL_MS = 30 * 60_000;
const APPROVAL_TTL_MS = 30 * 60_000;
const ACTIVE_APPROVAL_STATES = ["pending", "approved"] as const;

interface UserRegistryItem {
  id: string;
  displayName: string;
  email: string;
  username: string | null;
  accountState: string;
  credentialState: string;
  riskState: string;
  mfaState: string;
  employmentState: string | null;
  roles: string[];
  activeSessions: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalItem {
  id: string;
  proposerId: string;
  approverId: string | null;
  subjectId: string | null;
  operationCode: string;
  permissionCode: string;
  scope: Readonly<Record<string, unknown>>;
  reason: string;
  state: string;
  expiresAt: string;
  version: number;
  createdAt: string;
}

interface TotpEnrollmentReceipt {
  readonly secret: string;
  readonly uri: string;
  readonly expiresAt: string;
}

interface MfaCompletionReceipt {
  readonly recoveryCodes: readonly string[];
  readonly session: SessionReceipt;
}

interface ApprovalPayload {
  readonly operationCode: string;
  readonly permissionCode: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly expectedVersion: number;
  readonly transferRef?: string;
  readonly roleCode?: string;
  readonly scopeType?: string;
  readonly scopeId?: string | null;
  readonly previewFingerprint?: string;
  readonly nominationRef?: string;
}

interface StoredRoleAssignment extends EffectiveRoleAssignment {
  readonly userAccountId: string;
}

interface NormalizedRoleChange {
  readonly roleCode: string;
  readonly scopeType: RoleScopeType;
  readonly scopeId: string | null;
}

function requirePermission(context: AuthContext, permission: string): void {
  if (!context.permissions.includes(permission)) {
    throw new AppError(403, "permission_denied", "Недостаточно прав для операции");
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function uuidPublicId(prefix: string): string {
  return `${prefix}_${newUuid().replaceAll("-", "")}`;
}

function asDateIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function recoveryCode(): string {
  return randomBytes(10).toString("base64url").toUpperCase();
}

export function credentialDeliveryPayload(input: {
  readonly userAccountId: string;
  readonly credentialTokenId: string;
  readonly purpose: "invite" | "reset";
  readonly destination: string;
}): Readonly<Record<string, unknown>> {
  return {
    userAccountId: input.userAccountId,
    credentialTokenId: input.credentialTokenId,
    purpose: input.purpose,
    destination: input.destination,
  };
}

export class IdentityAdminService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: AppConfig,
    private readonly auth: IdentityService,
  ) {}

  /**
   * Reconstructs a one-time credential for the delivery worker. Only the token
   * id is persisted; neither the raw credential nor this derived value belongs
   * in logs, audit payloads, analytics, or the outbox.
   */
  deriveCredentialToken(tokenId: string, purpose: "invite" | "reset"): string {
    return deriveCredentialDeliveryToken(tokenId, purpose, this.config.credentialDelivery.tokenSecret);
  }

  async inviteUser(
    context: AuthContext,
    input: InviteUserInput,
    request: RequestContext,
  ): Promise<{ userId: string; expiresAt: string }> {
    requirePermission(context, "identity.users.invite");
    assertFreshMfa(context);
    const email = normalizeEmail(input.email);
    if (email === normalizeEmail(context.email)) {
      throw new AppError(403, "self_operation_denied", "Нельзя пригласить собственную учётную запись");
    }

    return this.db.transaction().execute(async (transaction) => {
      const duplicate = await transaction
        .selectFrom("identity.user_account")
        .select("id")
        .where("email", "=", email)
        .executeTakeFirst();
      if (duplicate) {
        throw new AppError(409, "user_already_exists", "Пользователь с таким email уже существует");
      }

      const now = new Date();
      const personId = newUuid();
      const userId = newUuid();
      await transaction
        .insertInto("identity.person")
        .values({
          id: personId,
          surname: input.surname.trim(),
          given_name: input.givenName.trim(),
          middle_name: input.middleName?.trim() || null,
          birth_date: null,
          normalized_email: email,
          normalized_phone: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await transaction
        .insertInto("identity.user_account")
        .values({
          id: userId,
          person_id: personId,
          email,
          username: null,
          password_hash: null,
          account_state: "active",
          credential_state: "invited",
          risk_state: "normal",
          mfa_state: "not_enrolled",
          failed_login_count: 0,
          locked_until: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();

      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      const credentialTokenId = await this.issueCredentialToken(
        transaction,
        userId,
        "invite",
        context.userAccountId,
        input.reason,
        expiresAt,
      );
      await appendAuditEvent(transaction, {
        eventType: "identity.user.invited",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId: userId,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: null,
        afterState: { accountState: "active", credentialState: "invited", mfaState: "not_enrolled" },
        metadata: { delivery: "outbox", credentialPurpose: "invite" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      await this.enqueue(
        transaction,
        "identity.credential.delivery_requested",
        "user_account",
        userId,
        credentialDeliveryPayload({
          userAccountId: userId,
          credentialTokenId,
          purpose: "invite",
          destination: email,
        }),
      );
      return { userId, expiresAt: expiresAt.toISOString() };
    });
  }

  async acceptCredential(
    input: CredentialTokenInput,
    purpose: "invite" | "reset",
    request: RequestContext,
  ): Promise<{ status: "password_set" }> {
    const tokenId = this.parseTokenId(input.token);
    const accountEmail = await this.db
      .selectFrom("identity.password_token as token")
      .innerJoin("identity.user_account as account", "account.id", "token.user_account_id")
      .select("account.email")
      .where("token.id", "=", tokenId)
      .executeTakeFirst();
    assertPasswordPolicy(input.password, accountEmail?.email);
    const passwordHash = await hashPassword(input.password, ARGON_OPTIONS);

    await this.db.transaction().execute(async (transaction) => {
      const token = await transaction
        .selectFrom("identity.password_token as token")
        .innerJoin("identity.user_account as account", "account.id", "token.user_account_id")
        .select([
          "token.id",
          "token.user_account_id",
          "token.purpose",
          "token.token_hash",
          "token.expires_at",
          "token.used_at",
          "token.revoked_at",
          "account.account_state",
          "account.version",
        ])
        .where("token.id", "=", tokenId)
        .forUpdate()
        .executeTakeFirst();

      const suppliedHash = keyedHash(input.token, this.config.session.tokenPepper);
      if (
        !token ||
        token.purpose !== purpose ||
        !secureHashEquals(token.token_hash, suppliedHash) ||
        token.used_at ||
        token.revoked_at ||
        new Date(token.expires_at) <= new Date()
      ) {
        throw new AppError(410, "credential_token_invalid", "Ссылка недействительна или уже использована");
      }
      if (token.account_state !== "active") {
        throw new AppError(403, "account_unavailable", "Учётная запись недоступна");
      }

      const privileged = await transaction
        .selectFrom("identity.user_role_assignment as assignment")
        .innerJoin("identity.role as role", "role.code", "assignment.role_code")
        .select("assignment.id")
        .where("assignment.user_account_id", "=", token.user_account_id)
        .where("assignment.valid_to", "is", null)
        .where("assignment.archived_at", "is", null)
        .where("role.is_privileged", "=", true)
        .executeTakeFirst();
      const now = new Date();
      await transaction
        .updateTable("identity.user_account")
        .set({
          password_hash: passwordHash,
          credential_state: "password_set",
          failed_login_count: 0,
          locked_until: null,
          risk_state: "normal",
          ...(privileged ? { mfa_state: "enrollment_required" } : {}),
        })
        .where("id", "=", token.user_account_id)
        .execute();
      await transaction
        .updateTable("identity.password_token")
        .set({ used_at: now })
        .where("id", "=", token.id)
        .where("used_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.password_token")
        .set({ revoked_at: now })
        .where("user_account_id", "=", token.user_account_id)
        .where("id", "!=", token.id)
        .where("used_at", "is", null)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.session")
        .set({ revoked_at: now, revoke_reason: `credential_${purpose}_completed` })
        .where("user_account_id", "=", token.user_account_id)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "cancelled" })
        .where("user_account_id", "=", token.user_account_id)
        .where("state", "=", "pending")
        .execute();
      await appendAuditEvent(transaction, {
        eventType: purpose === "invite" ? "identity.invite.accepted" : "identity.password.reset_completed",
        actorType: "user_account",
        actorId: token.user_account_id,
        subjectType: "user_account",
        subjectId: token.user_account_id,
        requestId: request.requestId,
        beforeState: { credentialState: purpose === "invite" ? "invited" : "change_required" },
        afterState: {
          credentialState: "password_set",
          ...(privileged ? { mfaState: "enrollment_required" } : {}),
        },
        metadata: { credentialPurpose: purpose },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "self" },
      });
      await this.enqueue(
        transaction,
        "identity.credential.completed",
        "user_account",
        token.user_account_id,
        {
          userAccountId: token.user_account_id,
          purpose,
        },
      );
    });
    return { status: "password_set" };
  }

  async beginTotpEnrollment(
    input: MfaChallengeInput,
    request: RequestContext,
  ): Promise<TotpEnrollmentReceipt> {
    if (!this.config.mfaEncryptionKeyBase64) {
      throw new AppError(503, "mfa_provider_unconfigured", "TOTP временно недоступен");
    }
    const secret = new OTPAuth.Secret({ size: 20 });
    const secretBase32 = secret.base32;
    const result = await this.db.transaction().execute(async (transaction) => {
      const challenge = await this.lockChallenge(transaction, input, "mfa_enrollment");
      const now = new Date();
      await transaction
        .updateTable("identity.mfa_factor")
        .set({ state: "revoked", archived_at: now })
        .where("user_account_id", "=", challenge.userAccountId)
        .where("provider_code", "=", "totp")
        .where("state", "=", "pending")
        .where("archived_at", "is", null)
        .execute();
      await transaction
        .insertInto("identity.mfa_factor")
        .values({
          id: newUuid(),
          user_account_id: challenge.userAccountId,
          provider_code: "totp",
          state: "pending",
          secret_ciphertext: encryptSecret(secretBase32, this.config.mfaEncryptionKeyBase64),
          provider_subject_ref: null,
          enrolled_at: null,
          last_used_at: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "identity.mfa.enrollment_started",
        actorType: "user_account",
        actorId: challenge.userAccountId,
        subjectType: "user_account",
        subjectId: challenge.userAccountId,
        requestId: request.requestId,
        metadata: { provider: "totp" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "self" },
      });
      return { userAccountId: challenge.userAccountId, expiresAt: challenge.expiresAt };
    });
    const totp = new OTPAuth.TOTP({
      issuer: "Курс на Север CRM",
      label: result.userAccountId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
    return { secret: secretBase32, uri: totp.toString(), expiresAt: result.expiresAt.toISOString() };
  }

  async confirmTotpEnrollment(
    input: ConfirmTotpInput,
    request: RequestContext,
  ): Promise<MfaCompletionReceipt> {
    const rawCodes = Array.from({ length: 10 }, recoveryCode);
    const enrollment = await this.db.transaction().execute(async (transaction) => {
      const challenge = await this.lockChallenge(transaction, input, "mfa_enrollment");
      const factor = await transaction
        .selectFrom("identity.mfa_factor")
        .select(["id", "secret_ciphertext"])
        .where("user_account_id", "=", challenge.userAccountId)
        .where("provider_code", "=", "totp")
        .where("state", "=", "pending")
        .where("archived_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!factor?.secret_ciphertext || !this.config.mfaEncryptionKeyBase64) {
        throw new AppError(409, "mfa_enrollment_not_started", "Сначала начните настройку TOTP");
      }
      const secret = decryptSecret(factor.secret_ciphertext, this.config.mfaEncryptionKeyBase64);
      if (!this.validateTotp(secret, input.code)) {
        await transaction
          .updateTable("identity.auth_challenge")
          .set((expression) => ({
            attempt_count: expression("attempt_count", "+", 1),
            state: sql<string>`case when attempt_count >= 4 then 'locked' else state end`,
          }))
          .where("id", "=", challenge.id)
          .where("attempt_count", "<", 5)
          .execute();
        await appendAuditEvent(transaction, {
          eventType: "identity.mfa.enrollment_verification_failed",
          actorType: "user_account",
          actorId: challenge.userAccountId,
          subjectType: "user_account",
          subjectId: challenge.userAccountId,
          requestId: request.requestId,
          metadata: { provider: "totp" },
          policyVersion: IDENTITY_POLICY_VERSION,
          scopeSnapshot: { scope: "self" },
        });
        return { status: "invalid" as const };
      }

      const now = new Date();
      await transaction
        .updateTable("identity.mfa_factor")
        .set({ state: "active", enrolled_at: now, last_used_at: now })
        .where("id", "=", factor.id)
        .where("state", "=", "pending")
        .execute();
      await transaction
        .updateTable("identity.user_account")
        .set({ mfa_state: "enrolled" })
        .where("id", "=", challenge.userAccountId)
        .execute();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "verified", verified_at: now })
        .where("id", "=", challenge.id)
        .where("state", "=", "pending")
        .execute();
      await transaction
        .deleteFrom("identity.recovery_code")
        .where("user_account_id", "=", challenge.userAccountId)
        .execute();
      await transaction
        .insertInto("identity.recovery_code")
        .values(
          rawCodes.map((code) => ({
            user_account_id: challenge.userAccountId,
            code_hash: keyedHash(code, this.config.session.tokenPepper),
            used_at: null,
            created_at: now,
          })),
        )
        .execute();
      const account = await transaction
        .selectFrom("identity.user_account as account")
        .innerJoin("identity.person as person", "person.id", "account.person_id")
        .select(["account.id", "account.person_id", "account.email", "person.given_name", "person.surname"])
        .where("account.id", "=", challenge.userAccountId)
        .executeTakeFirstOrThrow();
      await appendAuditEvent(transaction, {
        eventType: "identity.mfa.enrolled",
        actorType: "user_account",
        actorId: challenge.userAccountId,
        subjectType: "user_account",
        subjectId: challenge.userAccountId,
        requestId: request.requestId,
        beforeState: { mfaState: "enrollment_required" },
        afterState: { mfaState: "enrolled", provider: "totp", recoveryCodeCount: rawCodes.length },
        metadata: { provider: "totp" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "self" },
      });
      await this.enqueue(transaction, "identity.mfa.enrolled", "user_account", challenge.userAccountId, {
        userAccountId: challenge.userAccountId,
        provider: "totp",
      });
      const bootstrap = await this.advanceBootstrapState(transaction, now);
      if (bootstrap) {
        await appendAuditEvent(transaction, {
          eventType: `identity.bootstrap.${bootstrap.state}`,
          actorType: "system",
          actorId: null,
          subjectType: "bootstrap_ceremony",
          subjectId: null,
          requestId: request.requestId,
          afterState: { mode: bootstrap.mode, state: bootstrap.state },
          metadata: { checkpoint: "requested" },
          policyVersion: IDENTITY_POLICY_VERSION,
          scopeSnapshot: { scope: "platform_bootstrap" },
        });
        await this.enqueue(
          transaction,
          "identity.bootstrap.checkpoint_requested",
          "user_account",
          account.id,
          {
            mode: bootstrap.mode,
            state: bootstrap.state,
          },
        );
      }
      return { status: "valid" as const, account };
    });
    if (enrollment.status === "invalid") {
      throw new AppError(401, "invalid_mfa_code", "Неверный код подтверждения");
    }
    const identity = enrollment.account;
    const session = await this.auth.createSession(
      identity.id,
      identity.person_id,
      identity.email,
      `${identity.given_name} ${identity.surname}`,
      "mfa",
    );
    return { recoveryCodes: rawCodes, session };
  }

  async recoverMfa(input: RecoverMfaInput, request: RequestContext): Promise<SessionReceipt> {
    const recovery = await this.db.transaction().execute(async (transaction) => {
      const challenge = await this.lockChallenge(transaction, input, "mfa_login");
      const codeHash = keyedHash(input.recoveryCode.trim().toUpperCase(), this.config.session.tokenPepper);
      const consumed = await transaction
        .updateTable("identity.recovery_code")
        .set({ used_at: new Date() })
        .where("user_account_id", "=", challenge.userAccountId)
        .where("code_hash", "=", codeHash)
        .where("used_at", "is", null)
        .returning("code_hash")
        .executeTakeFirst();
      if (!consumed) {
        await transaction
          .updateTable("identity.auth_challenge")
          .set((expression) => ({
            attempt_count: expression("attempt_count", "+", 1),
            state: sql<string>`case when attempt_count >= 4 then 'locked' else state end`,
          }))
          .where("id", "=", challenge.id)
          .where("attempt_count", "<", 5)
          .execute();
        await appendAuditEvent(transaction, {
          eventType: "identity.mfa.recovery_verification_failed",
          actorType: "user_account",
          actorId: challenge.userAccountId,
          subjectType: "user_account",
          subjectId: challenge.userAccountId,
          requestId: request.requestId,
          metadata: { provider: "recovery_code" },
          policyVersion: IDENTITY_POLICY_VERSION,
          scopeSnapshot: { scope: "self" },
        });
        return { status: "invalid" as const };
      }
      const now = new Date();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "verified", verified_at: now })
        .where("id", "=", challenge.id)
        .where("state", "=", "pending")
        .execute();
      const remaining = await transaction
        .selectFrom("identity.recovery_code")
        .select((expression) => expression.fn.countAll<number>().as("count"))
        .where("user_account_id", "=", challenge.userAccountId)
        .where("used_at", "is", null)
        .executeTakeFirstOrThrow();
      if (Number(remaining.count) === 0) {
        await transaction
          .updateTable("identity.user_account")
          .set({ mfa_state: "recovery_required" })
          .where("id", "=", challenge.userAccountId)
          .execute();
      }
      const account = await transaction
        .selectFrom("identity.user_account as account")
        .innerJoin("identity.person as person", "person.id", "account.person_id")
        .select(["account.id", "account.person_id", "account.email", "person.given_name", "person.surname"])
        .where("account.id", "=", challenge.userAccountId)
        .executeTakeFirstOrThrow();
      await appendAuditEvent(transaction, {
        eventType: "identity.mfa.recovery_code_used",
        actorType: "user_account",
        actorId: challenge.userAccountId,
        subjectType: "user_account",
        subjectId: challenge.userAccountId,
        requestId: request.requestId,
        afterState: { remainingRecoveryCodes: Number(remaining.count) },
        metadata: { provider: "recovery_code" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "self" },
      });
      await this.enqueue(transaction, "identity.mfa.recovery_used", "user_account", challenge.userAccountId, {
        userAccountId: challenge.userAccountId,
        remainingRecoveryCodes: Number(remaining.count),
      });
      return { status: "valid" as const, account };
    });
    if (recovery.status === "invalid") {
      throw new AppError(401, "invalid_recovery_code", "Recovery code недействителен");
    }
    const identity = recovery.account;
    return this.auth.createSession(
      identity.id,
      identity.person_id,
      identity.email,
      `${identity.given_name} ${identity.surname}`,
      "mfa",
      30 * 60,
    );
  }

  async changeOwnPassword(
    context: AuthContext,
    input: ChangePasswordInput,
    request: RequestContext,
  ): Promise<SessionReceipt> {
    const account = await this.db
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.person as person", "person.id", "account.person_id")
      .select([
        "account.id",
        "account.person_id",
        "account.email",
        "account.password_hash",
        "account.mfa_state",
        "person.given_name",
        "person.surname",
      ])
      .where("account.id", "=", context.userAccountId)
      .executeTakeFirstOrThrow();
    if (
      !account.password_hash ||
      !(await verifyPasswordHash(account.password_hash, input.currentPassword).catch(() => false))
    ) {
      throw new AppError(401, "invalid_credentials", "Неверный текущий пароль");
    }
    if (await verifyPasswordHash(account.password_hash, input.newPassword).catch(() => false)) {
      throw new AppError(422, "password_reuse_denied", "Новый пароль должен отличаться от текущего");
    }
    if (account.mfa_state === "enrolled") {
      if (!input.mfaCode || !(await this.auth.verifyFactor(account.id, "totp", input.mfaCode))) {
        throw new AppError(401, "invalid_mfa_code", "Неверный код подтверждения");
      }
    }
    assertPasswordPolicy(input.newPassword, account.email);
    const passwordHash = await hashPassword(input.newPassword, ARGON_OPTIONS);
    await this.db.transaction().execute(async (transaction) => {
      const now = new Date();
      await transaction
        .updateTable("identity.user_account")
        .set({ password_hash: passwordHash, credential_state: "password_set" })
        .where("id", "=", context.userAccountId)
        .execute();
      await transaction
        .updateTable("identity.session")
        .set({ revoked_at: now, revoke_reason: "password_changed" })
        .where("user_account_id", "=", context.userAccountId)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.password_token")
        .set({ revoked_at: now })
        .where("user_account_id", "=", context.userAccountId)
        .where("used_at", "is", null)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "cancelled" })
        .where("user_account_id", "=", context.userAccountId)
        .where("state", "=", "pending")
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "identity.password.changed",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId: context.userAccountId,
        requestId: request.requestId,
        metadata: { sessionsRevoked: true },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "self" },
      });
      await this.enqueue(transaction, "identity.password.changed", "user_account", context.userAccountId, {
        userAccountId: context.userAccountId,
      });
    });
    return this.auth.createSession(
      account.id,
      account.person_id,
      account.email,
      `${account.given_name} ${account.surname}`,
      account.mfa_state === "enrolled" ? "mfa" : "password",
    );
  }

  async requestAdminPasswordReset(
    context: AuthContext,
    subjectId: string,
    input: { readonly reason: string },
    request: RequestContext,
  ): Promise<{ expiresAt: string }> {
    requirePermission(context, "identity.credentials.reset");
    assertFreshMfa(context);
    assertNoSelf(context.userAccountId, subjectId);
    return this.db.transaction().execute(async (transaction) => {
      const account = await transaction
        .selectFrom("identity.user_account")
        .select(["id", "email", "account_state", "credential_state"])
        .where("id", "=", subjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!account) {
        throw new AppError(404, "user_not_found", "Пользователь не найден");
      }
      if (account.account_state !== "active") {
        throw new AppError(409, "account_state_conflict", "Сначала активируйте учётную запись");
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
      await transaction
        .updateTable("identity.password_token")
        .set({ revoked_at: now })
        .where("user_account_id", "=", subjectId)
        .where("used_at", "is", null)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.session")
        .set({ revoked_at: now, revoke_reason: "admin_password_reset" })
        .where("user_account_id", "=", subjectId)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "cancelled" })
        .where("user_account_id", "=", subjectId)
        .where("state", "=", "pending")
        .execute();
      await transaction
        .updateTable("identity.user_account")
        .set({ credential_state: "change_required" })
        .where("id", "=", subjectId)
        .execute();
      const credentialTokenId = await this.issueCredentialToken(
        transaction,
        subjectId,
        "reset",
        context.userAccountId,
        input.reason,
        expiresAt,
      );
      await appendAuditEvent(transaction, {
        eventType: "identity.password.admin_reset_requested",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: { credentialState: account.credential_state },
        afterState: { credentialState: "change_required", sessionsRevoked: true },
        metadata: { delivery: "outbox", credentialPurpose: "reset" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      await this.enqueue(
        transaction,
        "identity.credential.delivery_requested",
        "user_account",
        subjectId,
        credentialDeliveryPayload({
          userAccountId: subjectId,
          credentialTokenId,
          purpose: "reset",
          destination: account.email,
        }),
      );
      return { expiresAt: expiresAt.toISOString() };
    });
  }

  async listUsers(context: AuthContext, query: UserListQuery): Promise<Page<UserRegistryItem>> {
    requirePermission(context, "identity.users.read");
    const limit = boundedLimit(query.limit, 50, 200);
    const cursor = decodeCursor(query.cursor, this.config.cursorSigningKey);
    let builder = this.db
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.person as person", "person.id", "account.person_id")
      .leftJoin("identity.employee_profile as employee", "employee.person_id", "person.id")
      .select([
        "account.id",
        "account.email",
        "account.username",
        "account.account_state",
        "account.credential_state",
        "account.risk_state",
        "account.mfa_state",
        "account.version",
        "account.created_at",
        "account.updated_at",
        "person.given_name",
        "person.surname",
        "employee.employment_state",
        sql<
          string[]
        >`coalesce((select array_agg(a.role_code order by a.role_code) from identity.user_role_assignment a where a.user_account_id = account.id and a.valid_to is null and a.archived_at is null), '{}'::text[])`.as(
          "roles",
        ),
        sql<number>`(select count(*)::int from identity.session s where s.user_account_id = account.id and s.revoked_at is null and s.absolute_expires_at > clock_timestamp())`.as(
          "active_sessions",
        ),
      ])
      .orderBy("account.created_at", "desc")
      .orderBy("account.id", "desc")
      .limit(limit + 1);
    if (cursor) {
      builder = builder.where((expression) =>
        expression.or([
          expression("account.created_at", "<", new Date(cursor.createdAt)),
          expression.and([
            expression("account.created_at", "=", new Date(cursor.createdAt)),
            expression("account.id", "<", cursor.id),
          ]),
        ]),
      );
    }
    if (query.accountState) {
      builder = builder.where("account.account_state", "=", query.accountState);
    }
    if (query.mfaState) {
      builder = builder.where("account.mfa_state", "=", query.mfaState);
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      builder = builder.where((expression) =>
        expression.or([
          expression("account.email", "ilike", search),
          expression("person.given_name", "ilike", search),
          expression("person.surname", "ilike", search),
        ]),
      );
    }
    const rows = await builder.execute();
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const items = selected.map((row) => ({
      id: row.id,
      displayName: `${row.given_name} ${row.surname}`,
      email: row.email,
      username: row.username,
      accountState: row.account_state,
      credentialState: row.credential_state,
      riskState: row.risk_state,
      mfaState: row.mfa_state,
      employmentState: row.employment_state,
      roles: row.roles,
      activeSessions: Number(row.active_sessions),
      version: Number(row.version),
      createdAt: asDateIso(row.created_at),
      updatedAt: asDateIso(row.updated_at),
    }));
    const last = selected.at(-1);
    return {
      items,
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor(
                { createdAt: asDateIso(last.created_at), id: last.id },
                this.config.cursorSigningKey,
              )
            : null,
      },
    };
  }

  async getUser(context: AuthContext, subjectId: string): Promise<UserRegistryItem> {
    const page = await this.listUsers(context, { limit: 200 });
    const fromPage = page.items.find((item) => item.id === subjectId);
    if (fromPage) {
      return fromPage;
    }
    const account = await this.db
      .selectFrom("identity.user_account")
      .select("id")
      .where("id", "=", subjectId)
      .executeTakeFirst();
    if (!account) {
      throw new AppError(404, "user_not_found", "Пользователь не найден");
    }
    // The registry may contain more than 200 entries; use a deterministic one-row path.
    const row = await this.db
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.person as person", "person.id", "account.person_id")
      .leftJoin("identity.employee_profile as employee", "employee.person_id", "person.id")
      .select([
        "account.id",
        "account.email",
        "account.username",
        "account.account_state",
        "account.credential_state",
        "account.risk_state",
        "account.mfa_state",
        "account.version",
        "account.created_at",
        "account.updated_at",
        "person.given_name",
        "person.surname",
        "employee.employment_state",
        sql<
          string[]
        >`coalesce((select array_agg(a.role_code order by a.role_code) from identity.user_role_assignment a where a.user_account_id = account.id and a.valid_to is null and a.archived_at is null), '{}'::text[])`.as(
          "roles",
        ),
        sql<number>`(select count(*)::int from identity.session s where s.user_account_id = account.id and s.revoked_at is null and s.absolute_expires_at > clock_timestamp())`.as(
          "active_sessions",
        ),
      ])
      .where("account.id", "=", subjectId)
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      displayName: `${row.given_name} ${row.surname}`,
      email: row.email,
      username: row.username,
      accountState: row.account_state,
      credentialState: row.credential_state,
      riskState: row.risk_state,
      mfaState: row.mfa_state,
      employmentState: row.employment_state,
      roles: row.roles,
      activeSessions: Number(row.active_sessions),
      version: Number(row.version),
      createdAt: asDateIso(row.created_at),
      updatedAt: asDateIso(row.updated_at),
    };
  }

  async previewEffectiveAccess(
    context: AuthContext,
    subjectId: string,
    input: RolePreviewInput,
  ): Promise<EffectiveAccessPreview> {
    requirePermission(context, ROLE_PREVIEW_OPERATION.permissionCode);
    const definition = roleOperation(input.operationKey);
    this.assertPreviewDomainAuthority(context, definition);
    const account = await this.db
      .selectFrom("identity.user_account")
      .select(["id", "version"])
      .where("id", "=", subjectId)
      .executeTakeFirst();
    if (!account) {
      throw new AppError(404, "user_not_found", "Пользователь не найден");
    }
    if (Number(account.version) !== input.expectedVersion) {
      throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена", {
        details: { currentVersion: Number(account.version) },
      });
    }
    const change = this.normalizeRoleChange(definition, input);
    const assignments = await this.loadRoleAssignments(this.db, subjectId);
    return this.buildEffectiveAccessPreview(
      this.db,
      subjectId,
      Number(account.version),
      definition,
      change,
      assignments,
    );
  }

  async changeRole(
    context: AuthContext,
    subjectId: string,
    operationKey: RoleOperationKey,
    input: RoleChangeInput,
    request: RequestContext,
  ): Promise<AdminOperationResult> {
    const definition = roleOperation(operationKey);
    requirePermission(context, definition.permissionCode);
    assertFreshMfa(context);
    assertNoSelf(context.userAccountId, subjectId);
    if (!definition.criticalApproval && input.approvalRequestId) {
      throw new AppError(422, "approval_not_allowed", "Для этой операции согласование не используется");
    }
    if (!definition.nominationRequired && input.nominationRef) {
      throw new AppError(422, "nomination_not_allowed", "Для этой операции номинация не используется");
    }
    if (!definition.transferRequired && input.transferRef) {
      throw new AppError(
        422,
        "transfer_not_allowed",
        "Для этой операции подтверждение передачи не используется",
      );
    }

    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(4936470200)`.execute(transaction);
      const account = await transaction
        .selectFrom("identity.user_account")
        .select([
          "id",
          "person_id",
          "account_state",
          "credential_state",
          "risk_state",
          "mfa_state",
          "version",
        ])
        .where("id", "=", subjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!account) {
        throw new AppError(404, "user_not_found", "Пользователь не найден");
      }
      if (Number(account.version) !== input.expectedVersion) {
        throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена", {
          details: { currentVersion: Number(account.version) },
        });
      }
      if (definition.action === "assign" && account.account_state !== "active") {
        throw new AppError(409, "account_not_active", "Роль можно назначить только активному пользователю");
      }

      const change = this.normalizeRoleChange(definition, input);
      await this.assertRoleAuthority(transaction, context, definition, change);
      await this.assertAssignedScopeBelongsToSubject(
        transaction,
        subjectId,
        account.person_id,
        definition,
        change,
      );
      const assignments = await this.loadRoleAssignments(transaction, subjectId);
      const matching = assignments.find(
        (assignment) =>
          assignment.roleCode === change.roleCode &&
          assignment.scopeType === change.scopeType &&
          assignment.scopeId === change.scopeId,
      );
      if (definition.action === "assign" && matching) {
        throw new AppError(409, "role_already_assigned", "Такая роль и область уже назначены");
      }
      if (definition.action === "revoke" && !matching) {
        throw new AppError(404, "role_assignment_not_found", "Активное назначение роли не найдено");
      }

      const preview = await this.buildEffectiveAccessPreview(
        transaction,
        subjectId,
        Number(account.version),
        definition,
        change,
        assignments,
      );
      if (!secureHashEquals(preview.previewFingerprint, input.previewFingerprint)) {
        throw new AppError(409, "effective_access_preview_stale", "Предпросмотр доступа устарел", {
          details: { currentPreviewFingerprint: preview.previewFingerprint },
        });
      }

      await this.assertRoleOperationGuards(transaction, account, definition, change, input, preview);
      const payload: ApprovalPayload = {
        operationCode: definition.operationId,
        permissionCode: definition.permissionCode,
        subjectId,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        roleCode: change.roleCode,
        scopeType: change.scopeType,
        scopeId: change.scopeId,
        previewFingerprint: input.previewFingerprint,
        ...(input.nominationRef ? { nominationRef: input.nominationRef } : {}),
        ...(input.transferRef ? { transferRef: input.transferRef } : {}),
      };
      if (definition.criticalApproval) {
        const approval = await this.requireOrCreateApproval(
          transaction,
          context,
          payload,
          input.approvalRequestId,
          request,
          definition.approverRole,
        );
        if (approval.status === "approval_required") {
          return approval;
        }
      }

      const now = new Date();
      if (definition.action === "assign") {
        await transaction
          .insertInto("identity.user_role_assignment")
          .values({
            id: newUuid(),
            user_account_id: subjectId,
            role_code: change.roleCode,
            scope_type: change.scopeType,
            scope_id: change.scopeId,
            valid_from: now,
            valid_to: null,
            assigned_by: context.userAccountId,
            reason: input.reason,
            created_at: now,
            updated_at: now,
            archived_at: null,
          })
          .execute();
      } else {
        const revoked = await transaction
          .updateTable("identity.user_role_assignment")
          .set({ valid_to: now, archived_at: now, updated_at: now })
          .where("id", "=", matching?.id ?? "")
          .where("valid_to", "is", null)
          .where("archived_at", "is", null)
          .executeTakeFirst();
        if (Number(revoked.numUpdatedRows) !== 1) {
          throw new AppError(409, "role_assignment_conflict", "Назначение роли уже изменено");
        }
      }

      const updatedAccount = await transaction
        .updateTable("identity.user_account")
        .set({ updated_at: now })
        .where("id", "=", subjectId)
        .where("version", "=", input.expectedVersion)
        .returning("version")
        .executeTakeFirst();
      if (!updatedAccount) {
        throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена");
      }
      const sessionResult = await transaction
        .updateTable("identity.session")
        .set({ revoked_at: now, revoke_reason: "role_assignment_changed" })
        .where("user_account_id", "=", subjectId)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      const sessionsRevoked = Number(sessionResult.numUpdatedRows);

      await appendAuditEvent(transaction, {
        eventType: "identity.role_assignment_changed",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: {
          accountVersion: Number(account.version),
          assignments: preview.currentAssignments,
          permissions: preview.currentPermissions,
        },
        afterState: {
          accountVersion: Number(updatedAccount.version),
          assignments: preview.proposedAssignments,
          permissions: preview.proposedPermissions,
        },
        metadata: {
          operationCode: definition.operationId,
          permissionCode: definition.permissionCode,
          action: definition.action,
          roleCode: change.roleCode,
          previewFingerprint: preview.previewFingerprint,
          sessionsRevoked,
          ...(input.approvalRequestId ? { approvalRequestId: input.approvalRequestId } : {}),
          ...(input.nominationRef ? { nominationRef: input.nominationRef } : {}),
          ...(input.transferRef ? { transferRef: input.transferRef } : {}),
        },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scopeType: change.scopeType, scopeId: change.scopeId },
      });
      await this.enqueue(transaction, "identity.role_assignment.changed.v1", "user_account", subjectId, {
        userAccountId: subjectId,
        operationCode: definition.operationId,
        action: definition.action,
        roleCode: change.roleCode,
        scopeType: change.scopeType,
        scopeId: change.scopeId,
        accountVersion: Number(updatedAccount.version),
        policyVersion: IDENTITY_POLICY_VERSION,
        sessionsRevoked,
      });
      if (definition.criticalApproval && input.approvalRequestId) {
        await this.markApprovalExecuted(transaction, input.approvalRequestId, context.userAccountId);
      }
      return {
        status: "completed",
        resourceId: subjectId,
        version: Number(updatedAccount.version),
      };
    });
  }

  async transitionUser(
    context: AuthContext,
    subjectId: string,
    action: "enable" | "disable" | "archive",
    input: VersionedReasonInput,
    request: RequestContext,
  ): Promise<AdminOperationResult> {
    requirePermission(context, action === "enable" ? "identity.users.enable" : "identity.users.disable");
    assertFreshMfa(context);
    assertNoSelf(context.userAccountId, subjectId);
    const operationCode =
      action === "enable" ? "EnableUser" : action === "disable" ? "DisableUser" : "ArchiveUser";
    const permissionCode = action === "enable" ? "identity.users.enable" : "identity.users.disable";
    const payload: ApprovalPayload = {
      operationCode,
      permissionCode,
      subjectId,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      ...(input.transferRef ? { transferRef: input.transferRef } : {}),
    };

    return this.db.transaction().execute(async (transaction) => {
      const account = await transaction
        .selectFrom("identity.user_account")
        .select([
          "id",
          "person_id",
          "account_state",
          "credential_state",
          "risk_state",
          "mfa_state",
          "version",
        ])
        .where("id", "=", subjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!account) {
        throw new AppError(404, "user_not_found", "Пользователь не найден");
      }
      if (Number(account.version) !== input.expectedVersion) {
        throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена", {
          details: { currentVersion: Number(account.version) },
        });
      }
      const transitionAllowed =
        (action === "enable" && account.account_state === "disabled") ||
        (action === "disable" && account.account_state === "active") ||
        (action === "archive" && account.account_state !== "archived");
      if (!transitionAllowed) {
        throw new AppError(
          409,
          "account_state_transition_denied",
          "Переход состояния учётной записи запрещён",
          {
            details: { currentState: account.account_state, action },
          },
        );
      }
      const roles = await this.activeRoles(transaction, subjectId);
      const privileged = hasPrivilegedRole(roles);
      if (
        action !== "enable" &&
        (roles.includes("migration_operator") || roles.includes("audit_reader")) &&
        !input.transferRef
      ) {
        throw new AppError(
          409,
          "operational_transfer_evidence_required",
          "Укажите ссылку на подтверждённую передачу operational ownership",
        );
      }
      if (privileged && action !== "enable") {
        const approval = await this.requireOrCreateApproval(
          transaction,
          context,
          payload,
          input.approvalRequestId,
          request,
        );
        if (approval.status === "approval_required") {
          return approval;
        }
        await this.assertPrivilegedMinimums(transaction, subjectId, roles);
      }
      if (action !== "enable") {
        await this.assertNoOwnedWork(transaction, subjectId, account.person_id);
      }
      const nextState = action === "enable" ? "active" : action === "disable" ? "disabled" : "archived";
      const now = new Date();
      const updated = await transaction
        .updateTable("identity.user_account")
        .set({
          account_state: nextState,
          ...(action === "archive" ? { archived_at: now } : action === "enable" ? { archived_at: null } : {}),
        })
        .where("id", "=", subjectId)
        .where("version", "=", input.expectedVersion)
        .returning("version")
        .executeTakeFirst();
      if (!updated) {
        throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена");
      }
      if (action !== "enable") {
        await transaction
          .updateTable("identity.session")
          .set({ revoked_at: now, revoke_reason: `account_${action}` })
          .where("user_account_id", "=", subjectId)
          .where("revoked_at", "is", null)
          .execute();
        await transaction
          .updateTable("identity.auth_challenge")
          .set({ state: "cancelled" })
          .where("user_account_id", "=", subjectId)
          .where("state", "=", "pending")
          .execute();
        await transaction
          .updateTable("identity.password_token")
          .set({ revoked_at: now })
          .where("user_account_id", "=", subjectId)
          .where("used_at", "is", null)
          .where("revoked_at", "is", null)
          .execute();
      }
      await appendAuditEvent(transaction, {
        eventType: `identity.user.${action}d`,
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: {
          accountState: account.account_state,
          credentialState: account.credential_state,
          riskState: account.risk_state,
          mfaState: account.mfa_state,
          version: Number(account.version),
        },
        afterState: { accountState: nextState, version: Number(updated.version) },
        metadata: {
          privileged,
          sessionsRevoked: action !== "enable",
          ...(input.transferRef ? { transferRef: input.transferRef } : {}),
        },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      await this.enqueue(transaction, `identity.user.${action}d`, "user_account", subjectId, {
        userAccountId: subjectId,
        accountState: nextState,
      });
      if (input.approvalRequestId) {
        await this.markApprovalExecuted(transaction, input.approvalRequestId, context.userAccountId);
      }
      return { status: "completed", resourceId: subjectId, version: Number(updated.version) };
    });
  }

  async resetUserMfa(
    context: AuthContext,
    subjectId: string,
    input: VersionedReasonInput,
    request: RequestContext,
  ): Promise<AdminOperationResult> {
    requirePermission(context, "identity.mfa.reset");
    assertFreshMfa(context);
    assertNoSelf(context.userAccountId, subjectId);
    const payload: ApprovalPayload = {
      operationCode: "ResetUserMfa",
      permissionCode: "identity.mfa.reset",
      subjectId,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
    };
    return this.db.transaction().execute(async (transaction) => {
      const account = await transaction
        .selectFrom("identity.user_account")
        .select(["id", "version", "mfa_state"])
        .where("id", "=", subjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!account) {
        throw new AppError(404, "user_not_found", "Пользователь не найден");
      }
      if (Number(account.version) !== input.expectedVersion) {
        throw new AppError(409, "version_conflict", "Карточка пользователя уже изменена", {
          details: { currentVersion: Number(account.version) },
        });
      }
      const roles = await this.activeRoles(transaction, subjectId);
      const privileged = hasPrivilegedRole(roles);
      if (privileged) {
        const approval = await this.requireOrCreateApproval(
          transaction,
          context,
          payload,
          input.approvalRequestId,
          request,
        );
        if (approval.status === "approval_required") {
          return approval;
        }
      }
      const now = new Date();
      await transaction
        .updateTable("identity.mfa_factor")
        .set({ state: "revoked", archived_at: now })
        .where("user_account_id", "=", subjectId)
        .where("state", "!=", "revoked")
        .where("archived_at", "is", null)
        .execute();
      await transaction
        .deleteFrom("identity.recovery_code")
        .where("user_account_id", "=", subjectId)
        .execute();
      const updated = await transaction
        .updateTable("identity.user_account")
        .set({ mfa_state: "enrollment_required" })
        .where("id", "=", subjectId)
        .where("version", "=", input.expectedVersion)
        .returning("version")
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("identity.session")
        .set({ revoked_at: now, revoke_reason: "mfa_reset" })
        .where("user_account_id", "=", subjectId)
        .where("revoked_at", "is", null)
        .execute();
      await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "cancelled" })
        .where("user_account_id", "=", subjectId)
        .where("state", "=", "pending")
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "identity.mfa.reset",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: { mfaState: account.mfa_state, version: Number(account.version) },
        afterState: { mfaState: "enrollment_required", version: Number(updated.version) },
        metadata: { privileged, sessionsRevoked: true },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      await this.enqueue(transaction, "identity.mfa.reset", "user_account", subjectId, {
        userAccountId: subjectId,
        enrollmentRequired: true,
      });
      if (input.approvalRequestId) {
        await this.markApprovalExecuted(transaction, input.approvalRequestId, context.userAccountId);
      }
      return { status: "completed", resourceId: subjectId, version: Number(updated.version) };
    });
  }

  async listUserSessions(
    context: AuthContext,
    subjectId: string,
    query: AdminSessionListQuery,
    request: RequestContext,
  ): Promise<Page<AdminIdentitySessionItem>> {
    requirePermission(context, "identity.sessions.read_all");
    const limit = boundedLimit(query.limit, 50, 200);
    const signingKey = adminSessionCursorSigningKey(
      this.config.cursorSigningKey,
      context.userAccountId,
      subjectId,
    );
    const cursor = decodeCursor(query.cursor, signingKey);
    return this.db.transaction().execute(async (transaction) => {
      const exists = await transaction
        .selectFrom("identity.user_account")
        .select("id")
        .where("id", "=", subjectId)
        .executeTakeFirst();
      if (!exists) {
        throw new AppError(404, "user_not_found", "Пользователь не найден");
      }
      let builder = transaction
        .selectFrom("identity.session")
        .select([
          "id",
          "authentication_level",
          "ip_prefix",
          "created_at",
          "last_seen_at",
          "absolute_expires_at",
          "revoked_at",
        ])
        .where("user_account_id", "=", subjectId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(limit + 1);
      if (cursor) {
        builder = builder.where((expression) =>
          expression.or([
            expression("created_at", "<", new Date(cursor.createdAt)),
            expression.and([
              expression("created_at", "=", new Date(cursor.createdAt)),
              expression("id", "<", cursor.id),
            ]),
          ]),
        );
      }
      const rows = await builder.execute();
      const hasMore = rows.length > limit;
      const selected = rows.slice(0, limit);
      const items = selected.map((session) => ({
        id: session.id,
        authenticationLevel: session.authentication_level as AdminIdentitySessionItem["authenticationLevel"],
        ipPrefix: session.ip_prefix,
        createdAt: asDateIso(session.created_at),
        lastSeenAt: asDateIso(session.last_seen_at),
        absoluteExpiresAt: asDateIso(session.absolute_expires_at),
        revokedAt: session.revoked_at ? asDateIso(session.revoked_at) : null,
      }));
      const last = selected.at(-1);
      await appendAuditEvent(transaction, {
        eventType: "identity.sessions.admin_viewed",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason: query.reason,
        afterState: { sessionCount: items.length, hasMore },
        metadata: { ipPolicy: "masked_prefix" },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      return {
        items,
        page: {
          limit,
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeCursor({ createdAt: asDateIso(last.created_at), id: last.id }, signingKey)
              : null,
        },
      };
    });
  }

  async revokeUserSessions(
    context: AuthContext,
    subjectId: string,
    reason: string,
    request: RequestContext,
  ): Promise<{ revokedCount: number }> {
    requirePermission(context, "identity.sessions.revoke_all");
    assertFreshMfa(context);
    assertNoSelf(context.userAccountId, subjectId);
    return this.db.transaction().execute(async (transaction) => {
      const result = await transaction
        .updateTable("identity.session")
        .set({ revoked_at: new Date(), revoke_reason: reason })
        .where("user_account_id", "=", subjectId)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      const revokedCount = Number(result.numUpdatedRows);
      await appendAuditEvent(transaction, {
        eventType: "identity.sessions.admin_revoked",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "user_account",
        subjectId,
        requestId: request.requestId,
        reason,
        afterState: { revokedCount },
        metadata: {},
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "all" },
      });
      await this.enqueue(transaction, "identity.sessions.revoked", "user_account", subjectId, {
        userAccountId: subjectId,
        revokedCount,
      });
      return { revokedCount };
    });
  }

  async listApprovals(context: AuthContext, query: ApprovalListQuery): Promise<Page<ApprovalItem>> {
    requirePermission(context, "identity.approvals.read");
    const limit = boundedLimit(query.limit, 50, 200);
    const cursor = decodeCursor(query.cursor, this.config.cursorSigningKey);
    let builder = this.db
      .selectFrom("identity.approval_request")
      .select([
        "public_id",
        "proposer_id",
        "approver_id",
        "subject_id",
        "operation_code",
        "permission_code",
        "scope",
        "reason",
        "state",
        "expires_at",
        "version",
        "created_at",
        "id",
      ])
      .where("archived_at", "is", null)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1);
    if (!context.roles.includes("platform_superadmin")) {
      const approvableOperationIds = approvableRoleOperationIds(context.roles);
      builder =
        approvableOperationIds.length > 0
          ? builder.where((expression) =>
              expression.or([
                expression("proposer_id", "=", context.userAccountId),
                expression("operation_code", "in", [...approvableOperationIds]),
              ]),
            )
          : builder.where("proposer_id", "=", context.userAccountId);
    }
    if (query.state) {
      builder = builder.where("state", "=", query.state);
    }
    if (cursor) {
      builder = builder.where((expression) =>
        expression.or([
          expression("created_at", "<", new Date(cursor.createdAt)),
          expression.and([
            expression("created_at", "=", new Date(cursor.createdAt)),
            expression("id", "<", cursor.id),
          ]),
        ]),
      );
    }
    const rows = await builder.execute();
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const items = selected.map((row) => ({
      id: row.public_id,
      proposerId: row.proposer_id,
      approverId: row.approver_id,
      subjectId: row.subject_id,
      operationCode: row.operation_code,
      permissionCode: row.permission_code,
      scope: row.scope as Readonly<Record<string, unknown>>,
      reason: row.reason,
      state: row.state,
      expiresAt: asDateIso(row.expires_at),
      version: Number(row.version),
      createdAt: asDateIso(row.created_at),
    }));
    const last = selected.at(-1);
    return {
      items,
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor(
                { createdAt: asDateIso(last.created_at), id: last.id },
                this.config.cursorSigningKey,
              )
            : null,
      },
    };
  }

  async decideApproval(
    context: AuthContext,
    approvalId: string,
    input: DecideApprovalInput,
    request: RequestContext,
  ): Promise<{ id: string; state: "approved" | "rejected"; version: number }> {
    requirePermission(context, "identity.approvals.decide");
    assertFreshMfa(context);
    return this.db.transaction().execute(async (transaction) => {
      const approval = await transaction
        .selectFrom("identity.approval_request")
        .selectAll()
        .where("public_id", "=", approvalId)
        .where("archived_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!approval) {
        throw new AppError(404, "approval_not_found", "Согласование не найдено");
      }
      if (approval.state !== "pending" || new Date(approval.expires_at) <= new Date()) {
        throw new AppError(409, "approval_not_pending", "Согласование уже закрыто или истекло");
      }
      if (Number(approval.version) !== input.expectedVersion) {
        throw new AppError(409, "version_conflict", "Согласование уже изменено", {
          details: { currentVersion: Number(approval.version) },
        });
      }
      assertNoSelf(context.userAccountId, approval.proposer_id);
      if (approval.subject_id) {
        assertNoSelf(context.userAccountId, approval.subject_id);
      }
      const roleOperationDefinition = roleOperationByOperationId(approval.operation_code);
      if (roleOperationDefinition) {
        if (
          !roleOperationDefinition.criticalApproval ||
          !roleOperationDefinition.approverRole ||
          roleOperationDefinition.permissionCode !== approval.permission_code
        ) {
          throw new AppError(
            409,
            "approval_policy_drift",
            "Согласование не соответствует текущему реестру операций",
          );
        }
        await this.assertEligibleRole(
          transaction,
          context.userAccountId,
          roleOperationDefinition.approverRole,
        );
      } else {
        requirePermission(context, approval.permission_code);
        await this.assertEligibleSuperadmin(transaction, context.userAccountId);
      }
      const state = input.decision === "approve" ? "approved" : "rejected";
      const updated = await transaction
        .updateTable("identity.approval_request")
        .set({ approver_id: context.userAccountId, state, decided_at: new Date() })
        .where("id", "=", approval.id)
        .where("state", "=", "pending")
        .where("version", "=", input.expectedVersion)
        .returning("version")
        .executeTakeFirst();
      if (!updated) {
        throw new AppError(409, "approval_conflict", "Согласование уже изменено");
      }
      await appendAuditEvent(transaction, {
        eventType: `identity.approval.${state}`,
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "approval_request",
        subjectId: approval.id,
        requestId: request.requestId,
        reason: input.reason,
        beforeState: { state: "pending", version: Number(approval.version) },
        afterState: { state, version: Number(updated.version) },
        metadata: {
          operationCode: approval.operation_code,
          permissionCode: approval.permission_code,
          payloadHash: approval.payload_hash,
        },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: approval.scope as Readonly<Record<string, unknown>>,
      });
      await this.enqueue(transaction, `identity.approval.${state}`, "approval_request", approval.id, {
        approvalRequestId: approval.public_id,
        state,
      });
      return { id: approval.public_id, state, version: Number(updated.version) };
    });
  }

  private normalizeRoleChange(
    definition: RoleOperationDefinition,
    input: Pick<RoleChangeInput, "roleCode" | "scopeType" | "scopeId">,
  ): NormalizedRoleChange {
    const roleCode = definition.roleFromBody ? input.roleCode : definition.targetRoles[0]?.code;
    if (!roleCode) {
      throw new AppError(422, "role_code_required", "Укажите роль из разрешённого реестра");
    }
    const target = definition.targetRoles.find((candidate) => candidate.code === roleCode);
    if (!target) {
      throw new AppError(422, "role_not_allowed", "Эта роль недоступна для выбранной операции");
    }
    if (!target.scopeTypes.includes(input.scopeType)) {
      throw new AppError(422, "role_scope_not_allowed", "Область недоступна для выбранной роли", {
        details: { roleCode, allowedScopeTypes: target.scopeTypes },
      });
    }
    const noIdentifierScope = input.scopeType === "all" || input.scopeType === "self";
    if (noIdentifierScope && input.scopeId) {
      throw new AppError(422, "scope_id_forbidden", "Для этой области идентификатор не используется");
    }
    if (!noIdentifierScope && !input.scopeId) {
      throw new AppError(422, "scope_id_required", "Для этой области нужен идентификатор");
    }
    return {
      roleCode,
      scopeType: input.scopeType,
      scopeId: noIdentifierScope ? null : (input.scopeId ?? null),
    };
  }

  private async loadRoleAssignments(
    database: Kysely<Database> | Transaction<Database>,
    subjectId: string,
  ): Promise<StoredRoleAssignment[]> {
    const now = new Date();
    const rows = await database
      .selectFrom("identity.user_role_assignment as assignment")
      .innerJoin("identity.role as role", "role.code", "assignment.role_code")
      .select([
        "assignment.id",
        "assignment.user_account_id",
        "assignment.role_code",
        "assignment.scope_type",
        "assignment.scope_id",
        "assignment.valid_from",
        "assignment.version",
        "role.domain",
        "role.is_privileged",
      ])
      .where("assignment.user_account_id", "=", subjectId)
      .where("assignment.archived_at", "is", null)
      .where("assignment.valid_from", "<=", now)
      .where((expression) =>
        expression.or([
          expression("assignment.valid_to", "is", null),
          expression("assignment.valid_to", ">", now),
        ]),
      )
      .orderBy("assignment.role_code", "asc")
      .orderBy("assignment.scope_type", "asc")
      .orderBy("assignment.scope_id", "asc")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      userAccountId: row.user_account_id,
      roleCode: row.role_code,
      domain: row.domain,
      privileged: row.is_privileged,
      scopeType: row.scope_type as RoleScopeType,
      scopeId: row.scope_id,
      validFrom: asDateIso(row.valid_from),
      version: Number(row.version),
    }));
  }

  private async permissionsForAssignments(
    database: Kysely<Database> | Transaction<Database>,
    assignments: readonly EffectiveRoleAssignment[],
  ): Promise<string[]> {
    const roleCodes = [...new Set(assignments.map((assignment) => assignment.roleCode))];
    if (roleCodes.length === 0) {
      return [];
    }
    const rows = await database
      .selectFrom("identity.role_permission")
      .select("permission_code")
      .where("role_code", "in", roleCodes)
      .orderBy("permission_code", "asc")
      .execute();
    return [...new Set(rows.map((row) => row.permission_code))];
  }

  private async buildEffectiveAccessPreview(
    database: Kysely<Database> | Transaction<Database>,
    subjectId: string,
    accountVersion: number,
    definition: RoleOperationDefinition,
    change: NormalizedRoleChange,
    currentAssignments: readonly StoredRoleAssignment[],
  ): Promise<EffectiveAccessPreview> {
    const domainAssignments = currentAssignments.filter(
      (assignment) => assignment.domain === definition.domain,
    );
    const matches = (assignment: EffectiveRoleAssignment) =>
      assignment.roleCode === change.roleCode &&
      assignment.scopeType === change.scopeType &&
      assignment.scopeId === change.scopeId;
    const proposedAssignments: EffectiveRoleAssignment[] =
      definition.action === "assign"
        ? [
            ...domainAssignments,
            {
              id: null,
              roleCode: change.roleCode,
              domain: definition.domain,
              privileged: definition.criticalApproval,
              scopeType: change.scopeType,
              scopeId: change.scopeId,
              validFrom: null,
              version: null,
            },
          ]
        : domainAssignments.filter((assignment) => !matches(assignment));
    proposedAssignments.sort(
      (left, right) =>
        left.roleCode.localeCompare(right.roleCode) ||
        left.scopeType.localeCompare(right.scopeType) ||
        (left.scopeId ?? "").localeCompare(right.scopeId ?? ""),
    );
    const currentPermissions = await this.permissionsForAssignments(database, domainAssignments);
    const proposedPermissions = await this.permissionsForAssignments(database, proposedAssignments);
    const currentSet = new Set(currentPermissions);
    const proposedSet = new Set(proposedPermissions);
    const addedPermissions = proposedPermissions.filter((permission) => !currentSet.has(permission));
    const removedPermissions = currentPermissions.filter((permission) => !proposedSet.has(permission));
    const fingerprint = effectiveAccessFingerprint({
      subjectId,
      accountVersion,
      operationKey: definition.key,
      operationId: definition.operationId,
      action: definition.action,
      roleCode: change.roleCode,
      scopeType: change.scopeType,
      scopeId: change.scopeId,
      currentAssignments: domainAssignments.map((assignment) => ({
        id: assignment.id,
        roleCode: assignment.roleCode,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        version: assignment.version,
      })),
      currentPermissions,
      proposedPermissions,
    });
    return {
      userId: subjectId,
      accountVersion,
      policyVersion: IDENTITY_POLICY_VERSION,
      domain: definition.domain,
      operationKey: definition.key,
      operationId: definition.operationId,
      action: definition.action,
      roleCode: change.roleCode,
      scopeType: change.scopeType,
      scopeId: change.scopeId,
      currentAssignments: domainAssignments,
      proposedAssignments,
      currentPermissions,
      proposedPermissions,
      addedPermissions,
      removedPermissions,
      requiresApproval: definition.criticalApproval,
      approverRole: definition.approverRole ?? null,
      previewFingerprint: fingerprint,
    };
  }

  private assertPreviewDomainAuthority(context: AuthContext, definition: RoleOperationDefinition): void {
    if (context.roles.includes("platform_superadmin")) {
      return;
    }
    const domainRole = definition.domain === "crm" ? "crm_admin" : "project_admin";
    if (
      (definition.domain !== "crm" && definition.domain !== "project") ||
      !context.roles.includes(domainRole)
    ) {
      throw new AppError(403, "role_preview_scope_denied", "Предпросмотр недоступен вне домена оператора");
    }
  }

  private async assertRoleAuthority(
    transaction: Transaction<Database>,
    context: AuthContext,
    definition: RoleOperationDefinition,
    change: NormalizedRoleChange,
  ): Promise<void> {
    if (!definition.actorRoles.some((role) => context.roles.includes(role))) {
      throw new AppError(403, "role_authority_denied", "Роль оператора не разрешает эту операцию");
    }
    const now = new Date();
    const grants = await transaction
      .selectFrom("identity.user_role_assignment")
      .select(["role_code", "scope_type", "scope_id"])
      .where("user_account_id", "=", context.userAccountId)
      .where("role_code", "in", [...definition.actorRoles])
      .where("valid_from", "<=", now)
      .where("archived_at", "is", null)
      .where((expression) =>
        expression.or([expression("valid_to", "is", null), expression("valid_to", ">", now)]),
      )
      .execute();
    const allowed = grants.some(
      (grant) =>
        grant.scope_type === "all" ||
        (grant.scope_type === change.scopeType && grant.scope_id === change.scopeId),
    );
    if (!allowed) {
      throw new AppError(403, "role_scope_authority_denied", "Целевая область шире полномочий оператора");
    }
  }

  private async assertAssignedScopeBelongsToSubject(
    transaction: Transaction<Database>,
    subjectId: string,
    personId: string,
    definition: RoleOperationDefinition,
    change: NormalizedRoleChange,
  ): Promise<void> {
    if (definition.domain !== "crm" || change.scopeType !== "assigned") {
      return;
    }
    const employee = await transaction
      .selectFrom("identity.employee_profile")
      .select("id")
      .where("person_id", "=", personId)
      .where("employment_state", "=", "active")
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!employee || employee.id !== change.scopeId) {
      throw new AppError(409, "employee_scope_mismatch", "Assigned scope должен ссылаться на сотрудника", {
        details: { subjectId },
      });
    }
  }

  private async assertRoleOperationGuards(
    transaction: Transaction<Database>,
    account: {
      id: string;
      person_id: string;
      account_state: string;
      credential_state: string;
      risk_state: string;
      mfa_state: string;
      version: number | bigint;
    },
    definition: RoleOperationDefinition,
    change: NormalizedRoleChange,
    input: RoleChangeInput,
    preview: EffectiveAccessPreview,
  ): Promise<void> {
    if (definition.nominationRequired && !input.nominationRef) {
      throw new AppError(409, "nomination_evidence_required", "Нужна ссылка на утверждённую номинацию");
    }
    if (definition.transferRequired && !input.transferRef) {
      throw new AppError(
        409,
        "operational_transfer_evidence_required",
        "Нужна ссылка на передачу обязанностей",
      );
    }
    const role = await transaction
      .selectFrom("identity.role")
      .select(["code", "is_privileged"])
      .where("code", "=", change.roleCode)
      .executeTakeFirst();
    if (!role) {
      throw new AppError(409, "role_registry_drift", "Роль отсутствует в базе данных");
    }
    if (
      definition.action === "assign" &&
      role.is_privileged &&
      (account.account_state !== "active" ||
        account.credential_state !== "password_set" ||
        account.risk_state !== "normal" ||
        account.mfa_state !== "enrolled")
    ) {
      throw new AppError(
        409,
        "privileged_subject_not_eligible",
        "Привилегированную роль можно назначить только eligible-пользователю",
      );
    }
    if (definition.criticalApproval || definition.requiresClosedProductionBootstrap) {
      await this.assertProductionBootstrapClosed(transaction);
    }
    const eligibleCount = await this.countEligibleRole(transaction, change.roleCode);
    if (definition.requiresZeroEligibleRole && eligibleCount !== 0) {
      throw new AppError(
        409,
        "initial_admin_already_assigned",
        "Начальная роль администратора уже назначена",
      );
    }
    if (definition.requiresExistingEligibleRole && eligibleCount < 1) {
      throw new AppError(
        409,
        "domain_admin_missing",
        "Сначала выполните начальное назначение администратора",
      );
    }
    if (definition.action === "revoke" && role.is_privileged) {
      await this.assertPrivilegedMinimums(transaction, account.id, [change.roleCode]);
    }
    if (definition.minimumEligibleAfter !== undefined) {
      const remaining = await this.countEligibleRole(transaction, change.roleCode, account.id);
      if (remaining < definition.minimumEligibleAfter) {
        throw new AppError(409, "privileged_minimum_violation", "Сначала назначьте подходящего преемника", {
          details: {
            role: change.roleCode,
            requiredAfter: definition.minimumEligibleAfter,
            actualAfter: remaining,
          },
        });
      }
    }
    if (
      definition.action === "revoke" &&
      definition.ownershipGuard === "crm" &&
      !preview.proposedAssignments.some((assignment) => assignment.domain === "crm")
    ) {
      await this.assertNoOwnedWork(transaction, account.id, account.person_id);
    }
  }

  private async assertProductionBootstrapClosed(transaction: Transaction<Database>): Promise<void> {
    const ceremony = await transaction
      .selectFrom("identity.bootstrap_ceremony")
      .select(["mode", "state"])
      .where("singleton", "=", true)
      .forUpdate()
      .executeTakeFirst();
    if (ceremony?.mode !== "production" || ceremony?.state !== "closed") {
      throw new AppError(
        409,
        "production_bootstrap_not_closed",
        "Критическая операция с ролями доступна только после закрытого production bootstrap",
      );
    }
  }

  private async countEligibleRole(
    transaction: Transaction<Database>,
    roleCode: string,
    excludedUserId?: string,
  ): Promise<number> {
    let query = transaction
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.user_role_assignment as assignment", "assignment.user_account_id", "account.id")
      .select(sql<number>`count(distinct account.id)::int`.as("count"))
      .where("account.account_state", "=", "active")
      .where("account.credential_state", "=", "password_set")
      .where("account.risk_state", "=", "normal")
      .where("account.mfa_state", "=", "enrolled")
      .where("assignment.role_code", "=", roleCode)
      .where("assignment.valid_to", "is", null)
      .where("assignment.archived_at", "is", null);
    if (excludedUserId) {
      query = query.where("account.id", "!=", excludedUserId);
    }
    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private parseTokenId(token: string): string {
    const [id, proof, extra] = token.split(".");
    if (!id || !proof || extra || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new AppError(410, "credential_token_invalid", "Ссылка недействительна или уже использована");
    }
    return id;
  }

  private async issueCredentialToken(
    transaction: Transaction<Database>,
    userAccountId: string,
    purpose: "invite" | "reset",
    createdBy: string,
    reason: string,
    expiresAt: Date,
  ): Promise<string> {
    const tokenId = newUuid();
    const token = this.deriveCredentialToken(tokenId, purpose);
    await transaction
      .insertInto("identity.password_token")
      .values({
        id: tokenId,
        user_account_id: userAccountId,
        purpose,
        token_hash: keyedHash(token, this.config.session.tokenPepper),
        expires_at: expiresAt,
        used_at: null,
        revoked_at: null,
        created_by: createdBy,
        reason,
        created_at: new Date(),
      })
      .execute();
    return tokenId;
  }

  private async lockChallenge(
    transaction: Transaction<Database>,
    input: MfaChallengeInput,
    type: "mfa_enrollment" | "mfa_login",
  ): Promise<{ id: string; userAccountId: string; expiresAt: Date }> {
    const challenge = await transaction
      .selectFrom("identity.auth_challenge as challenge")
      .innerJoin("identity.user_account as account", "account.id", "challenge.user_account_id")
      .select([
        "challenge.id",
        "challenge.user_account_id",
        "challenge.challenge_type",
        "challenge.token_hash",
        "challenge.state",
        "challenge.expires_at",
        "account.account_state",
        "account.risk_state",
      ])
      .where("challenge.public_id", "=", input.challengeId)
      .forUpdate()
      .executeTakeFirst();
    const suppliedHash = keyedHash(input.challengeToken, this.config.session.tokenPepper);
    if (
      !challenge ||
      challenge.challenge_type !== type ||
      challenge.state !== "pending" ||
      !secureHashEquals(challenge.token_hash, suppliedHash) ||
      new Date(challenge.expires_at) <= new Date()
    ) {
      throw new AppError(401, "invalid_mfa_challenge", "Проверка второго фактора недействительна");
    }
    if (challenge.account_state !== "active" || challenge.risk_state !== "normal") {
      throw new AppError(403, "account_unavailable", "Учётная запись недоступна");
    }
    return {
      id: challenge.id,
      userAccountId: challenge.user_account_id,
      expiresAt: challenge.expires_at instanceof Date ? challenge.expires_at : new Date(challenge.expires_at),
    };
  }

  private validateTotp(secretBase32: string, code: string): boolean {
    const totp = new OTPAuth.TOTP({
      issuer: "Курс на Север CRM",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  private async activeRoles(transaction: Transaction<Database>, subjectId: string): Promise<string[]> {
    const rows = await transaction
      .selectFrom("identity.user_role_assignment")
      .select("role_code")
      .where("user_account_id", "=", subjectId)
      .where("valid_to", "is", null)
      .where("archived_at", "is", null)
      .execute();
    return rows.map((row) => row.role_code);
  }

  private async advanceBootstrapState(
    transaction: Transaction<Database>,
    now: Date,
  ): Promise<{ mode: "production" | "non_production_prototype"; state: "completed" | "closed" } | null> {
    const result = await sql<{
      mode: "production" | "non_production_prototype";
      state: "completed" | "closed";
    }>`
      with ceremony as (
        select mode, first_person_id, second_person_id
        from identity.bootstrap_ceremony
        where singleton = true and state = 'pending_acceptance'
        for update
      ), eligible as (
        select count(distinct account.id)::int as count
        from ceremony
        join identity.user_account account
          on account.person_id in (ceremony.first_person_id, ceremony.second_person_id)
        join identity.user_role_assignment assignment
          on assignment.user_account_id = account.id
         and assignment.role_code = 'platform_superadmin'
         and assignment.valid_to is null
         and assignment.archived_at is null
        where account.account_state = 'active'
          and account.credential_state = 'password_set'
          and account.risk_state = 'normal'
          and account.mfa_state = 'enrolled'
      )
      update identity.bootstrap_ceremony target
      set state = case when target.mode = 'production' then 'closed' else 'completed' end,
          completed_at = ${now},
          closed_at = case when target.mode = 'production' then ${now} else null end
      from eligible
      where target.singleton = true
        and target.state = 'pending_acceptance'
        and (
          (target.mode = 'production' and eligible.count = 2)
          or (target.mode = 'non_production_prototype' and eligible.count = 1)
        )
      returning target.mode, target.state
    `.execute(transaction);
    return result.rows[0] ?? null;
  }

  private async requireOrCreateApproval(
    transaction: Transaction<Database>,
    context: AuthContext,
    payload: ApprovalPayload,
    approvalRequestId: string | undefined,
    request: RequestContext,
    requiredApproverRole: "platform_superadmin" | "crm_admin" | "project_admin" = "platform_superadmin",
  ): Promise<AdminOperationResult> {
    const payloadHash = approvalPayloadHash({ ...payload });
    const scopeSnapshot = {
      scope: payload.scopeType ?? "all",
      expectedVersion: payload.expectedVersion,
      ...(payload.roleCode ? { roleCode: payload.roleCode } : {}),
      ...(payload.scopeType ? { scopeType: payload.scopeType } : {}),
      ...(payload.scopeId ? { scopeId: payload.scopeId } : {}),
      ...(payload.previewFingerprint ? { previewFingerprint: payload.previewFingerprint } : {}),
      ...(payload.nominationRef ? { nominationRef: payload.nominationRef } : {}),
      ...(payload.transferRef ? { transferRef: payload.transferRef } : {}),
    };
    if (approvalRequestId) {
      const approval = await transaction
        .selectFrom("identity.approval_request")
        .selectAll()
        .where("public_id", "=", approvalRequestId)
        .where("archived_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (
        approval?.state !== "approved" ||
        approval.proposer_id !== context.userAccountId ||
        approval.subject_id !== payload.subjectId ||
        approval.operation_code !== payload.operationCode ||
        approval.permission_code !== payload.permissionCode ||
        approval.payload_hash !== payloadHash ||
        !approval.approver_id ||
        approval.approver_id === context.userAccountId ||
        new Date(approval.expires_at) <= new Date()
      ) {
        throw new AppError(403, "approval_binding_invalid", "Согласование не соответствует операции");
      }
      await this.assertEligibleRole(transaction, approval.approver_id, requiredApproverRole);
      return { status: "completed", resourceId: payload.subjectId };
    }

    const existing = await transaction
      .selectFrom("identity.approval_request")
      .select(["public_id", "expires_at"])
      .where("proposer_id", "=", context.userAccountId)
      .where("subject_id", "=", payload.subjectId)
      .where("operation_code", "=", payload.operationCode)
      .where("payload_hash", "=", payloadHash)
      .where("state", "=", "pending")
      .where("expires_at", ">", new Date())
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (existing) {
      return {
        status: "approval_required",
        resourceId: payload.subjectId,
        approval: { id: existing.public_id, expiresAt: asDateIso(existing.expires_at) },
      };
    }

    const id = newUuid();
    const publicId = uuidPublicId("approval");
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
    await transaction
      .insertInto("identity.approval_request")
      .values({
        id,
        public_id: publicId,
        proposer_id: context.userAccountId,
        approver_id: null,
        subject_id: payload.subjectId,
        operation_code: payload.operationCode,
        permission_code: payload.permissionCode,
        scope: scopeSnapshot,
        payload_hash: payloadHash,
        reason: payload.reason,
        state: "pending",
        expires_at: expiresAt,
        decided_at: null,
        executed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        archived_at: null,
      })
      .execute();
    await appendAuditEvent(transaction, {
      eventType: "identity.approval.requested",
      actorType: "user_account",
      actorId: context.userAccountId,
      subjectType: "approval_request",
      subjectId: id,
      requestId: request.requestId,
      reason: payload.reason,
      afterState: {
        state: "pending",
        operationCode: payload.operationCode,
        permissionCode: payload.permissionCode,
        expiresAt: expiresAt.toISOString(),
      },
      metadata: { payloadHash },
      policyVersion: IDENTITY_POLICY_VERSION,
      scopeSnapshot,
    });
    await this.enqueue(transaction, "identity.approval.requested", "approval_request", id, {
      approvalRequestId: publicId,
      operationCode: payload.operationCode,
      permissionCode: payload.permissionCode,
    });
    return {
      status: "approval_required",
      resourceId: payload.subjectId,
      approval: { id: publicId, expiresAt: expiresAt.toISOString() },
    };
  }

  private async markApprovalExecuted(
    transaction: Transaction<Database>,
    approvalRequestId: string,
    proposerId: string,
  ): Promise<void> {
    const updated = await transaction
      .updateTable("identity.approval_request")
      .set({ state: "executed", executed_at: new Date() })
      .where("public_id", "=", approvalRequestId)
      .where("proposer_id", "=", proposerId)
      .where("state", "=", "approved")
      .where("expires_at", ">", new Date())
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) {
      throw new AppError(409, "approval_execution_conflict", "Согласование уже использовано");
    }
  }

  private async assertEligibleSuperadmin(
    transaction: Transaction<Database>,
    userAccountId: string,
  ): Promise<void> {
    return this.assertEligibleRole(transaction, userAccountId, "platform_superadmin");
  }

  private async assertEligibleRole(
    transaction: Transaction<Database>,
    userAccountId: string,
    roleCode: "platform_superadmin" | "crm_admin" | "project_admin",
  ): Promise<void> {
    const now = new Date();
    const eligible = await transaction
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.user_role_assignment as assignment", "assignment.user_account_id", "account.id")
      .select("account.id")
      .where("account.id", "=", userAccountId)
      .where("account.account_state", "=", "active")
      .where("account.credential_state", "=", "password_set")
      .where("account.risk_state", "=", "normal")
      .where("account.mfa_state", "=", "enrolled")
      .where("assignment.role_code", "=", roleCode)
      .where("assignment.valid_from", "<=", now)
      .where("assignment.archived_at", "is", null)
      .where((expression) =>
        expression.or([
          expression("assignment.valid_to", "is", null),
          expression("assignment.valid_to", ">", now),
        ]),
      )
      .executeTakeFirst();
    if (!eligible) {
      throw new AppError(403, "approver_not_eligible", "Подтверждающий не соответствует роли согласования", {
        details: { requiredRole: roleCode },
      });
    }
  }

  private async assertPrivilegedMinimums(
    transaction: Transaction<Database>,
    subjectId: string,
    roles: readonly string[],
  ): Promise<void> {
    const minimums: Readonly<Record<string, number>> = {
      platform_superadmin: 2,
      crm_admin: 1,
      project_admin: 1,
    };
    for (const role of roles) {
      const minimum = minimums[role];
      if (!minimum) {
        continue;
      }
      const row = await transaction
        .selectFrom("identity.user_account as account")
        .innerJoin("identity.user_role_assignment as assignment", "assignment.user_account_id", "account.id")
        .select((expression) => expression.fn.countAll<number>().as("count"))
        .where("account.id", "!=", subjectId)
        .where("account.account_state", "=", "active")
        .where("account.credential_state", "=", "password_set")
        .where("account.risk_state", "=", "normal")
        .where("account.mfa_state", "=", "enrolled")
        .where("assignment.role_code", "=", role)
        .where("assignment.valid_to", "is", null)
        .where("assignment.archived_at", "is", null)
        .executeTakeFirstOrThrow();
      if (Number(row.count) < minimum) {
        throw new AppError(409, "privileged_minimum_violation", "Сначала назначьте подходящего преемника", {
          details: { role, requiredAfter: minimum, actualAfter: Number(row.count) },
        });
      }
    }
    const orphanApprovals = await transaction
      .selectFrom("identity.approval_request")
      .select((expression) => expression.fn.countAll<number>().as("count"))
      .where((expression) =>
        expression.or([expression("proposer_id", "=", subjectId), expression("approver_id", "=", subjectId)]),
      )
      .where("state", "in", [...ACTIVE_APPROVAL_STATES])
      .where("archived_at", "is", null)
      .executeTakeFirstOrThrow();
    if (Number(orphanApprovals.count) > 0) {
      throw new AppError(
        409,
        "orphan_approval_guard",
        "Сначала передайте или закройте незавершённые согласования",
        {
          details: { count: Number(orphanApprovals.count) },
        },
      );
    }
  }

  private async assertNoOwnedWork(
    transaction: Transaction<Database>,
    userAccountId: string,
    personId: string,
  ): Promise<void> {
    const employee = await transaction
      .selectFrom("identity.employee_profile")
      .select("id")
      .where("person_id", "=", personId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    let activeAssignments = 0;
    let activeTasks = 0;
    if (employee) {
      const assignmentRow = await transaction
        .selectFrom("crm.case_assignment")
        .select((expression) => expression.fn.countAll<number>().as("count"))
        .where("employee_profile_id", "=", employee.id)
        .where("valid_to", "is", null)
        .where("archived_at", "is", null)
        .where("role", "in", ["owner", "curator"])
        .executeTakeFirstOrThrow();
      activeAssignments = Number(assignmentRow.count);
      const taskRow = await transaction
        .selectFrom("crm.task")
        .select((expression) => expression.fn.countAll<number>().as("count"))
        .where("responsible_employee_profile_id", "=", employee.id)
        .where("state", "not in", ["completed", "cancelled"])
        .where("archived_at", "is", null)
        .executeTakeFirstOrThrow();
      activeTasks = Number(taskRow.count);
    }
    const approvals = await transaction
      .selectFrom("identity.approval_request")
      .select((expression) => expression.fn.countAll<number>().as("count"))
      .where((expression) =>
        expression.or([
          expression("proposer_id", "=", userAccountId),
          expression("approver_id", "=", userAccountId),
        ]),
      )
      .where("state", "in", [...ACTIVE_APPROVAL_STATES])
      .where("archived_at", "is", null)
      .executeTakeFirstOrThrow();
    if (activeAssignments > 0 || activeTasks > 0 || Number(approvals.count) > 0) {
      throw new AppError(
        409,
        "ownership_transfer_required",
        "Сначала передайте активную работу и согласования",
        {
          details: { activeAssignments, activeTasks, pendingApprovals: Number(approvals.count) },
        },
      );
    }
  }

  private async enqueue(
    transaction: Transaction<Database>,
    topic: string,
    aggregateType: string,
    aggregateId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const id = newUuid();
    await transaction
      .insertInto("platform.outbox_event")
      .values({
        id,
        topic,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        payload,
        idempotency_key: `${topic}:${aggregateId}:${id}`,
        occurred_at: new Date(),
        available_at: new Date(),
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        delivered_at: null,
        last_error_code: null,
      })
      .execute();
  }
}
