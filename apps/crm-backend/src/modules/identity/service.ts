import { verify as verifyPasswordHash } from "@node-rs/argon2";
import type { FastifyRequest } from "fastify";
import { type Kysely, sql } from "kysely";
import * as OTPAuth from "otpauth";
import { AppError } from "../../common/errors.js";
import { newPublicId, newUuid } from "../../common/id.js";
import { boundedLimit, decodeCursor, encodeCursor, type Page } from "../../common/pagination.js";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../db/types.js";
import { appendAuditEvent } from "../platform/audit.js";
import type { CsrfRefreshReceipt } from "./auth-contracts.js";
import {
  type BusinessRole,
  BusinessRoleConflictError,
  resolveBusinessRole,
} from "./business-role-registry.js";
import { decryptSecret, keyedHash, randomToken, secureHashEquals } from "./crypto.js";
import type { IdentitySessionItem, SessionListQuery } from "./session-contracts.js";

export interface AuthContext {
  sessionId: string;
  userAccountId: string;
  personId: string;
  email: string;
  authenticationLevel: "password" | "mfa" | "fresh_mfa";
  csrfTokenHash: string;
  roles: readonly string[];
  permissions: readonly string[];
  businessRole: BusinessRole | null;
  employeeProfileId: string | null;
}

export interface SessionReceipt {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: readonly string[];
    permissions: readonly string[];
    businessRole: BusinessRole | null;
    employeeProfileId: string | null;
  };
}

export type LoginResult =
  | { status: "authenticated"; receipt: SessionReceipt }
  | {
      status: "mfa_required";
      challengeId: string;
      challengeToken: string;
      provider: "totp" | "max_otp";
      expiresAt: string;
    }
  | {
      status: "mfa_enrollment_required";
      challengeId: string;
      challengeToken: string;
      expiresAt: string;
    };

const INVALID_CREDENTIALS = new AppError(401, "invalid_credentials", "Неверный логин или пароль");

function asDateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function businessRoleOrDeny(roleCodes: readonly string[]): BusinessRole | null {
  try {
    return resolveBusinessRole(roleCodes);
  } catch (error) {
    if (error instanceof BusinessRoleConflictError) {
      throw new AppError(
        403,
        "business_role_conflict",
        "Для учётной записи обнаружены несовместимые продуктовые роли",
      );
    }
    throw error;
  }
}

function sessionCursorSigningKey(
  rootKey: string,
  operation: "own_sessions" | "admin_user_sessions",
  actorId: string,
  subjectId: string,
): string {
  return keyedHash(JSON.stringify({ version: 1, operation, actorId, subjectId }), rootKey);
}

export function ownSessionCursorSigningKey(rootKey: string, actorId: string): string {
  return sessionCursorSigningKey(rootKey, "own_sessions", actorId, actorId);
}

export function adminSessionCursorSigningKey(rootKey: string, actorId: string, subjectId: string): string {
  return sessionCursorSigningKey(rootKey, "admin_user_sessions", actorId, subjectId);
}

export class IdentityService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: AppConfig,
  ) {}

  async login(login: string, password: string): Promise<LoginResult> {
    const normalizedLogin = login.trim().toLowerCase();
    const account = await this.db
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.person as person", "person.id", "account.person_id")
      .select([
        "account.id",
        "account.person_id",
        "account.email",
        "account.password_hash",
        "account.account_state",
        "account.credential_state",
        "account.risk_state",
        "account.mfa_state",
        "account.locked_until",
        "person.surname",
        "person.given_name",
      ])
      .where((expression) =>
        expression.or([
          expression("account.email", "=", normalizedLogin),
          expression("account.username", "=", normalizedLogin),
        ]),
      )
      .executeTakeFirst();

    if (!account?.password_hash) {
      await this.constantTimePasswordFallback(password);
      throw INVALID_CREDENTIALS;
    }

    const validPassword = await verifyPasswordHash(account.password_hash, password).catch(() => false);
    if (!validPassword) {
      await this.recordFailedLogin(account.id);
      throw INVALID_CREDENTIALS;
    }

    if (
      account.account_state !== "active" ||
      account.credential_state !== "password_set" ||
      account.risk_state !== "normal" ||
      (account.locked_until && new Date(account.locked_until) > new Date())
    ) {
      throw new AppError(403, "account_unavailable", "Учётная запись недоступна");
    }

    await this.db
      .updateTable("identity.user_account")
      .set({ failed_login_count: 0, locked_until: null })
      .where("id", "=", account.id)
      .execute();

    if (this.config.auth.testMfaBypass) {
      const receipt = await this.db.transaction().execute(async (transaction) => {
        await appendAuditEvent(transaction, {
          eventType: "identity.session.test_mfa_bypass_authenticated",
          actorType: "user_account",
          actorId: account.id,
          subjectType: "user_account",
          subjectId: account.id,
          reason: "explicit_test_runtime_configuration",
          afterState: { authenticationLevel: "fresh_mfa" },
          metadata: { nodeEnv: this.config.nodeEnv },
          scopeSnapshot: { scope: "self" },
        });
        return this.createSessionWithDatabase(
          transaction,
          account.id,
          account.person_id,
          account.email,
          `${account.given_name} ${account.surname}`,
          "fresh_mfa",
        );
      });

      return { status: "authenticated", receipt };
    }

    const privilegedAssignment = await this.db
      .selectFrom("identity.user_role_assignment as assignment")
      .innerJoin("identity.role as role", "role.code", "assignment.role_code")
      .select("assignment.id")
      .where("assignment.user_account_id", "=", account.id)
      .where("assignment.archived_at", "is", null)
      .where("assignment.valid_to", "is", null)
      .where("role.is_privileged", "=", true)
      .executeTakeFirst();

    if (
      account.mfa_state === "enrollment_required" ||
      (account.mfa_state === "not_enrolled" && privilegedAssignment)
    ) {
      return { status: "mfa_enrollment_required", ...(await this.issueEnrollmentChallenge(account.id)) };
    }

    if (account.mfa_state === "enrolled" || account.mfa_state === "recovery_required") {
      const factor = await this.db
        .selectFrom("identity.mfa_factor")
        .select(["provider_code"])
        .where("user_account_id", "=", account.id)
        .where("state", "=", "active")
        .where("archived_at", "is", null)
        .orderBy(sql`case when provider_code = 'totp' then 0 else 1 end`)
        .executeTakeFirst();

      if (!factor || (factor.provider_code !== "totp" && factor.provider_code !== "max_otp")) {
        throw new AppError(503, "mfa_factor_unavailable", "Второй фактор временно недоступен");
      }

      const challengeToken = randomToken();
      const challengeId = newPublicId("session");
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await this.db
        .insertInto("identity.auth_challenge")
        .values({
          id: newUuid(),
          public_id: challengeId,
          user_account_id: account.id,
          challenge_type: "mfa_login",
          provider_code: factor.provider_code,
          token_hash: keyedHash(challengeToken, this.config.session.tokenPepper),
          state: "pending",
          attempt_count: 0,
          expires_at: expiresAt,
          verified_at: null,
          created_at: new Date(),
        })
        .execute();

      return {
        status: "mfa_required",
        challengeId,
        challengeToken,
        provider: factor.provider_code,
        expiresAt: expiresAt.toISOString(),
      };
    }

    return {
      status: "authenticated",
      receipt: await this.createSession(
        account.id,
        account.person_id,
        account.email,
        `${account.given_name} ${account.surname}`,
        "password",
      ),
    };
  }

  async verifyMfa(challengeId: string, challengeToken: string, code: string): Promise<SessionReceipt> {
    const providedTokenHash = keyedHash(challengeToken, this.config.session.tokenPepper);
    const result = await this.db.transaction().execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("identity.auth_challenge as challenge")
        .innerJoin("identity.user_account as account", "account.id", "challenge.user_account_id")
        .innerJoin("identity.person as person", "person.id", "account.person_id")
        .select([
          "challenge.id",
          "challenge.user_account_id",
          "challenge.provider_code",
          "challenge.token_hash",
          "challenge.state",
          "challenge.attempt_count",
          "challenge.expires_at",
          "account.person_id",
          "account.email",
          "account.account_state",
          "account.credential_state",
          "account.risk_state",
          "account.mfa_state",
          "person.given_name",
          "person.surname",
        ])
        .where("challenge.public_id", "=", challengeId)
        .forUpdate(["challenge", "account"])
        .executeTakeFirst();

      if (
        !challenge ||
        !secureHashEquals(challenge.token_hash, providedTokenHash) ||
        challenge.state !== "pending" ||
        new Date(challenge.expires_at) <= new Date()
      ) {
        throw new AppError(401, "invalid_mfa_challenge", "Проверка второго фактора недействительна");
      }
      if (
        challenge.account_state !== "active" ||
        challenge.credential_state !== "password_set" ||
        challenge.risk_state !== "normal" ||
        (challenge.mfa_state !== "enrolled" && challenge.mfa_state !== "recovery_required")
      ) {
        throw new AppError(403, "account_unavailable", "Учётная запись недоступна");
      }

      const accepted = await this.verifyFactor(
        challenge.user_account_id,
        challenge.provider_code,
        code,
        transaction,
      );
      if (!accepted) {
        const attempts = Math.min(challenge.attempt_count + 1, 5);
        const updated = await transaction
          .updateTable("identity.auth_challenge")
          .set({ attempt_count: attempts, ...(attempts >= 5 ? { state: "locked" } : {}) })
          .where("id", "=", challenge.id)
          .where("state", "=", "pending")
          .returning("id")
          .executeTakeFirst();
        if (!updated) {
          throw new AppError(409, "mfa_challenge_conflict", "Проверка уже была использована");
        }
        return { status: "invalid_code" as const };
      }

      const verified = await transaction
        .updateTable("identity.auth_challenge")
        .set({ state: "verified", verified_at: new Date() })
        .where("id", "=", challenge.id)
        .where("state", "=", "pending")
        .returning("id")
        .executeTakeFirst();
      if (!verified) {
        throw new AppError(409, "mfa_challenge_conflict", "Проверка уже была использована");
      }

      return {
        status: "authenticated" as const,
        receipt: await this.createSessionWithDatabase(
          transaction,
          challenge.user_account_id,
          challenge.person_id,
          challenge.email,
          `${challenge.given_name} ${challenge.surname}`,
          "mfa",
        ),
      };
    });

    if (result.status === "invalid_code") {
      throw new AppError(401, "invalid_mfa_code", "Неверный код подтверждения");
    }
    return result.receipt;
  }

  async authenticate(request: FastifyRequest): Promise<AuthContext> {
    const sessionToken = request.cookies[this.config.session.cookieName];
    if (!sessionToken) {
      throw new AppError(401, "authentication_required", "Требуется вход в CRM");
    }

    const tokenHash = keyedHash(sessionToken, this.config.session.tokenPepper);
    const session = await this.db
      .selectFrom("identity.session as session")
      .innerJoin("identity.user_account as account", "account.id", "session.user_account_id")
      .select([
        "session.id",
        "session.user_account_id",
        "session.csrf_token_hash",
        "session.authentication_level",
        "session.idle_expires_at",
        "session.absolute_expires_at",
        "session.revoked_at",
        "account.person_id",
        "account.email",
        "account.account_state",
        "account.credential_state",
        "account.risk_state",
        "account.mfa_state",
      ])
      .where("session.token_hash", "=", tokenHash)
      .executeTakeFirst();

    const now = new Date();
    if (
      !session ||
      session.revoked_at ||
      new Date(session.idle_expires_at) <= now ||
      new Date(session.absolute_expires_at) <= now ||
      session.account_state !== "active" ||
      session.credential_state !== "password_set" ||
      session.risk_state !== "normal"
    ) {
      throw new AppError(401, "session_expired", "Сессия завершена");
    }

    const effectiveIdentity = await this.loadEffectiveIdentity(
      this.db,
      session.user_account_id,
      session.person_id,
      now,
    );

    if (
      !this.config.auth.testMfaBypass &&
      effectiveIdentity.hasPrivilegedRole &&
      session.mfa_state !== "enrolled"
    ) {
      throw new AppError(403, "mfa_enrollment_required", "Для привилегированного доступа настройте MFA");
    }

    const idleExpiresAt = new Date(
      Math.min(
        now.getTime() + this.config.session.idleTtlSeconds * 1000,
        new Date(session.absolute_expires_at).getTime(),
      ),
    );
    await this.db
      .updateTable("identity.session")
      .set({ last_seen_at: now, idle_expires_at: idleExpiresAt })
      .where("id", "=", session.id)
      .execute();

    return {
      sessionId: session.id,
      userAccountId: session.user_account_id,
      personId: session.person_id,
      email: session.email,
      authenticationLevel: session.authentication_level as AuthContext["authenticationLevel"],
      csrfTokenHash: session.csrf_token_hash,
      roles: effectiveIdentity.roles,
      permissions: effectiveIdentity.permissions,
      businessRole: effectiveIdentity.businessRole,
      employeeProfileId: effectiveIdentity.employeeProfileId,
    };
  }

  assertCsrf(context: AuthContext, providedToken: string | undefined): void {
    if (!providedToken) {
      throw new AppError(403, "csrf_required", "Отсутствует CSRF-токен");
    }
    const providedHash = keyedHash(providedToken, this.config.session.tokenPepper);
    if (!secureHashEquals(context.csrfTokenHash, providedHash)) {
      throw new AppError(403, "csrf_invalid", "CSRF-токен недействителен");
    }
  }

  assertTrustedMutation(
    request: FastifyRequest,
    context: AuthContext,
    providedToken: string | undefined,
  ): void {
    this.assertTrustedOrigin(request);
    this.assertCsrf(context, providedToken);
  }

  assertTrustedOrigin(request: FastifyRequest): void {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const referer = typeof request.headers.referer === "string" ? request.headers.referer : undefined;
    let candidate = origin;
    if (!candidate && referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        throw new AppError(403, "origin_invalid", "Источник запроса недействителен");
      }
    }
    if (!candidate || !this.config.publicOrigins.includes(candidate)) {
      throw new AppError(403, "origin_not_trusted", "Источник запроса не разрешён");
    }
  }

  async refreshCsrfToken(context: AuthContext, requestId: string): Promise<CsrfRefreshReceipt> {
    const csrfToken = randomToken();
    const csrfTokenHash = keyedHash(csrfToken, this.config.session.tokenPepper);
    const now = new Date();
    await this.db.transaction().execute(async (transaction) => {
      const session = await transaction
        .selectFrom("identity.session as session")
        .innerJoin("identity.user_account as account", "account.id", "session.user_account_id")
        .select([
          "session.id",
          "session.user_account_id",
          "session.idle_expires_at",
          "session.absolute_expires_at",
          "session.revoked_at",
          "account.account_state",
          "account.credential_state",
          "account.risk_state",
        ])
        .where("session.id", "=", context.sessionId)
        .where("session.user_account_id", "=", context.userAccountId)
        .forUpdate(["session", "account"])
        .executeTakeFirst();
      if (
        !session ||
        session.revoked_at ||
        new Date(session.idle_expires_at) <= now ||
        new Date(session.absolute_expires_at) <= now ||
        session.account_state !== "active" ||
        session.credential_state !== "password_set" ||
        session.risk_state !== "normal"
      ) {
        throw new AppError(401, "session_expired", "Сессия завершена");
      }

      await transaction
        .updateTable("identity.session")
        .set({ csrf_token_hash: csrfTokenHash, last_seen_at: now })
        .where("id", "=", context.sessionId)
        .where("user_account_id", "=", context.userAccountId)
        .where("revoked_at", "is", null)
        .execute();
      await appendAuditEvent(transaction, {
        eventType: "identity.csrf.rotated",
        actorType: "user_account",
        actorId: context.userAccountId,
        subjectType: "session",
        subjectId: context.sessionId,
        requestId,
        afterState: { rotated: true },
        metadata: { mechanism: "trusted_origin_session_refresh" },
        scopeSnapshot: { scope: "self" },
      });
    });
    return { csrfToken };
  }

  requirePermission(context: AuthContext, permission: string): void {
    if (!context.permissions.includes(permission)) {
      throw new AppError(403, "permission_denied", "Недостаточно прав для операции");
    }
  }

  requireFreshMfa(context: AuthContext): void {
    if (context.authenticationLevel !== "fresh_mfa") {
      throw new AppError(403, "fresh_mfa_required", "Повторно подтвердите пароль и второй фактор");
    }
  }

  async reauthenticate(
    context: AuthContext,
    password: string,
    code: string | undefined,
  ): Promise<SessionReceipt> {
    const account = await this.db
      .selectFrom("identity.user_account as account")
      .innerJoin("identity.person as person", "person.id", "account.person_id")
      .select([
        "account.id",
        "account.person_id",
        "account.email",
        "account.password_hash",
        "account.account_state",
        "account.credential_state",
        "account.risk_state",
        "account.mfa_state",
        "person.given_name",
        "person.surname",
      ])
      .where("account.id", "=", context.userAccountId)
      .executeTakeFirst();

    if (
      !account?.password_hash ||
      account.account_state !== "active" ||
      account.credential_state !== "password_set" ||
      account.risk_state !== "normal" ||
      !(await verifyPasswordHash(account.password_hash, password).catch(() => false))
    ) {
      throw INVALID_CREDENTIALS;
    }
    if (account.mfa_state !== "enrolled" || !code) {
      throw new AppError(403, "fresh_mfa_required", "Для операции требуется настроенный второй фактор");
    }
    if (!(await this.verifyFactor(account.id, "totp", code))) {
      throw new AppError(401, "invalid_mfa_code", "Неверный код подтверждения");
    }

    const receipt = await this.createSession(
      account.id,
      account.person_id,
      account.email,
      `${account.given_name} ${account.surname}`,
      "fresh_mfa",
      10 * 60,
    );
    await this.db
      .updateTable("identity.session")
      .set({ revoked_at: new Date(), revoke_reason: "rotated_after_fresh_auth" })
      .where("id", "=", context.sessionId)
      .where("revoked_at", "is", null)
      .execute();
    return receipt;
  }

  async revokeSession(context: AuthContext, sessionId: string, reason: string): Promise<void> {
    if (sessionId === context.sessionId) {
      throw new AppError(409, "current_session_revoke_denied", "Текущую сессию завершите командой выхода");
    }
    const revoked = await this.db
      .updateTable("identity.session")
      .set({ revoked_at: new Date(), revoke_reason: reason })
      .where("id", "=", sessionId)
      .where("user_account_id", "=", context.userAccountId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (Number(revoked.numUpdatedRows) === 0) {
      throw new AppError(404, "session_not_found", "Сессия не найдена");
    }
  }

  async logoutCurrentSession(context: AuthContext): Promise<void> {
    await this.db
      .updateTable("identity.session")
      .set({ revoked_at: new Date(), revoke_reason: "user_logout" })
      .where("id", "=", context.sessionId)
      .where("user_account_id", "=", context.userAccountId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async listSessions(context: AuthContext, query: SessionListQuery = {}): Promise<Page<IdentitySessionItem>> {
    const limit = boundedLimit(query.limit, 50, 200);
    const signingKey = ownSessionCursorSigningKey(this.config.cursorSigningKey, context.userAccountId);
    const cursor = decodeCursor(query.cursor, signingKey);
    let builder = this.db
      .selectFrom("identity.session")
      .select([
        "id",
        "authentication_level",
        "created_at",
        "last_seen_at",
        "absolute_expires_at",
        "revoked_at",
      ])
      .where("user_account_id", "=", context.userAccountId)
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
      authenticationLevel: session.authentication_level as IdentitySessionItem["authenticationLevel"],
      createdAt: asDateIso(session.created_at),
      lastSeenAt: asDateIso(session.last_seen_at),
      absoluteExpiresAt: asDateIso(session.absolute_expires_at),
      revokedAt: session.revoked_at ? asDateIso(session.revoked_at) : null,
    }));
    const last = selected.at(-1);
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
  }

  private async constantTimePasswordFallback(password: string): Promise<void> {
    const fallbackHash =
      "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$7R0XDcRwBkxPp5Pv6c4py6ZBqGCFgJ7w+LziYyKN27E";
    await verifyPasswordHash(fallbackHash, password).catch(() => false);
  }

  private async recordFailedLogin(userAccountId: string): Promise<void> {
    await this.db
      .updateTable("identity.user_account")
      .set((expression) => ({
        failed_login_count: expression("failed_login_count", "+", 1),
        locked_until: sql<Date | null>`case when failed_login_count >= 9 then clock_timestamp() + interval '15 minutes' else locked_until end`,
        risk_state: sql<string>`case when failed_login_count >= 9 then 'locked' else risk_state end`,
      }))
      .where("id", "=", userAccountId)
      .execute();
  }

  async verifyFactor(
    userAccountId: string,
    providerCode: string,
    code: string,
    database: Kysely<Database> = this.db,
  ): Promise<boolean> {
    const factor = await database
      .selectFrom("identity.mfa_factor")
      .select(["id", "provider_code", "secret_ciphertext"])
      .where("user_account_id", "=", userAccountId)
      .where("provider_code", "=", providerCode)
      .where("state", "=", "active")
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!factor) {
      return false;
    }
    if (factor.provider_code === "max_otp") {
      throw new AppError(503, "mfa_provider_unconfigured", "MAX-подтверждение ещё не подключено");
    }
    if (!factor.secret_ciphertext || !this.config.mfaEncryptionKeyBase64) {
      throw new AppError(503, "mfa_provider_unconfigured", "TOTP-подтверждение не настроено");
    }

    const secret = decryptSecret(factor.secret_ciphertext, this.config.mfaEncryptionKeyBase64);
    const totp = new OTPAuth.TOTP({
      issuer: "Курс на Север CRM",
      label: userAccountId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return false;
    }
    await database
      .updateTable("identity.mfa_factor")
      .set({ last_used_at: new Date() })
      .where("id", "=", factor.id)
      .execute();
    return true;
  }

  async createSession(
    userAccountId: string,
    personId: string,
    email: string,
    displayName: string,
    authenticationLevel: AuthContext["authenticationLevel"],
    maximumTtlSeconds?: number,
  ): Promise<SessionReceipt> {
    return this.createSessionWithDatabase(
      this.db,
      userAccountId,
      personId,
      email,
      displayName,
      authenticationLevel,
      maximumTtlSeconds,
    );
  }

  private async createSessionWithDatabase(
    database: Kysely<Database>,
    userAccountId: string,
    personId: string,
    email: string,
    displayName: string,
    authenticationLevel: AuthContext["authenticationLevel"],
    maximumTtlSeconds?: number,
  ): Promise<SessionReceipt> {
    const now = new Date();
    const effectiveIdentity = await this.loadEffectiveIdentity(database, userAccountId, personId, now);
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const absoluteTtlSeconds = Math.min(
      this.config.session.absoluteTtlSeconds,
      maximumTtlSeconds ?? this.config.session.absoluteTtlSeconds,
    );
    const idleTtlSeconds = Math.min(this.config.session.idleTtlSeconds, absoluteTtlSeconds);
    const idleExpiresAt = new Date(now.getTime() + idleTtlSeconds * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + absoluteTtlSeconds * 1000);
    const sessionId = newUuid();
    await database
      .insertInto("identity.session")
      .values({
        id: sessionId,
        user_account_id: userAccountId,
        token_hash: keyedHash(sessionToken, this.config.session.tokenPepper),
        csrf_token_hash: keyedHash(csrfToken, this.config.session.tokenPepper),
        authentication_level: authenticationLevel,
        user_agent_hash: null,
        ip_prefix: null,
        created_at: now,
        last_seen_at: now,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
        revoked_at: null,
        revoke_reason: null,
      })
      .execute();

    return {
      sessionToken,
      csrfToken,
      expiresAt: absoluteExpiresAt.toISOString(),
      user: {
        id: userAccountId,
        email,
        displayName,
        roles: effectiveIdentity.roles,
        permissions: effectiveIdentity.permissions,
        businessRole: effectiveIdentity.businessRole,
        employeeProfileId: effectiveIdentity.employeeProfileId,
      },
    };
  }

  private async loadEffectiveIdentity(
    database: Kysely<Database>,
    userAccountId: string,
    personId: string,
    now: Date,
  ): Promise<{
    roles: readonly string[];
    permissions: readonly string[];
    businessRole: BusinessRole | null;
    employeeProfileId: string | null;
    hasPrivilegedRole: boolean;
  }> {
    const grants = await database
      .selectFrom("identity.user_role_assignment as assignment")
      .innerJoin("identity.role as role", "role.code", "assignment.role_code")
      .leftJoin("identity.role_permission as grant", "grant.role_code", "assignment.role_code")
      .select([
        "assignment.id as assignment_id",
        "assignment.role_code",
        "assignment.scope_type",
        "assignment.scope_id",
        "grant.permission_code",
        "role.is_privileged",
      ])
      .where("assignment.user_account_id", "=", userAccountId)
      .where("assignment.archived_at", "is", null)
      .where("assignment.valid_from", "<=", now)
      .where((expression) =>
        expression.or([
          expression("assignment.valid_to", "is", null),
          expression("assignment.valid_to", ">", now),
        ]),
      )
      .execute();
    const employee = await database
      .selectFrom("identity.employee_profile")
      .select(["id", "employment_state"])
      .where("person_id", "=", personId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    const roles = [...new Set(grants.map((grant) => grant.role_code))];
    const businessRole = businessRoleOrDeny(roles);
    if (businessRole === "SPECIALIST") {
      if (employee?.employment_state !== "active") {
        throw new AppError(
          403,
          "employee_profile_inactive",
          "Доступ специалиста требует активного профиля сотрудника",
        );
      }
      const specialistAssignments = new Map(
        grants
          .filter((grant) => grant.role_code === "crm_project_manager")
          .map((grant) => [grant.assignment_id, { scopeType: grant.scope_type, scopeId: grant.scope_id }]),
      );
      const assignment = [...specialistAssignments.values()][0];
      if (
        specialistAssignments.size !== 1 ||
        assignment?.scopeType !== "assigned" ||
        assignment.scopeId !== employee.id
      ) {
        throw new AppError(
          403,
          "specialist_scope_mismatch",
          "Назначение специалиста не соответствует активному профилю сотрудника",
        );
      }
    }
    return {
      roles,
      permissions: [
        ...new Set(grants.flatMap((grant) => (grant.permission_code ? [grant.permission_code] : []))),
      ],
      businessRole,
      employeeProfileId: employee?.id ?? null,
      hasPrivilegedRole: grants.some((grant) => grant.is_privileged),
    };
  }

  private async issueEnrollmentChallenge(userAccountId: string): Promise<{
    challengeId: string;
    challengeToken: string;
    expiresAt: string;
  }> {
    const challengeToken = randomToken();
    const challengeId = newPublicId("session");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.db
      .updateTable("identity.auth_challenge")
      .set({ state: "cancelled" })
      .where("user_account_id", "=", userAccountId)
      .where("challenge_type", "=", "mfa_enrollment")
      .where("state", "=", "pending")
      .execute();
    await this.db
      .insertInto("identity.auth_challenge")
      .values({
        id: newUuid(),
        public_id: challengeId,
        user_account_id: userAccountId,
        challenge_type: "mfa_enrollment",
        provider_code: "totp",
        token_hash: keyedHash(challengeToken, this.config.session.tokenPepper),
        state: "pending",
        attempt_count: 0,
        expires_at: expiresAt,
        verified_at: null,
        created_at: new Date(),
      })
      .execute();
    return { challengeId, challengeToken, expiresAt: expiresAt.toISOString() };
  }
}
