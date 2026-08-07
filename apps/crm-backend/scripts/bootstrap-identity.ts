import { sql } from "kysely";
import { z } from "zod";
import { newUuid } from "../src/common/id.js";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/client.js";
import { IDENTITY_POLICY_VERSION } from "../src/modules/identity/admin-policy.js";
import { credentialDeliveryPayload, IdentityAdminService } from "../src/modules/identity/admin-service.js";
import { keyedHash } from "../src/modules/identity/crypto.js";
import { IdentityService } from "../src/modules/identity/service.js";
import { appendAuditEvent } from "../src/modules/platform/audit.js";

const MAX_STDIN_BYTES = 64 * 1024;
const INVITE_TTL_MS = 48 * 60 * 60_000;

const personSchema = z
  .object({
    email: z.string().email().max(254),
    givenName: z.string().trim().min(1).max(120),
    surname: z.string().trim().min(1).max(120),
    middleName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const inputSchema = z
  .object({
    mode: z.enum(["production", "non_production_prototype"]),
    allowSingleAccount: z.literal(true).optional(),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    ownerApprovalRef: z.string().trim().min(3).max(256),
    ceremonyOperatorRef: z.string().trim().min(3).max(256),
    people: z.array(personSchema).min(1).max(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "production" && value.people.length !== 2) {
      context.addIssue({
        code: "custom",
        path: ["people"],
        message: "production requires exactly two people",
      });
    }
    if (
      value.mode === "non_production_prototype" &&
      (value.people.length !== 1 || value.allowSingleAccount !== true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowSingleAccount"],
        message: "prototype single-account bootstrap must be explicit",
      });
    }
    const emails = value.people.map((person) => person.email.trim().toLocaleLowerCase("en-US"));
    if (new Set(emails).size !== emails.length) {
      context.addIssue({ code: "custom", path: ["people"], message: "bootstrap people must be distinct" });
    }
  });

class BootstrapError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new BootstrapError("stdin_required", "Bootstrap manifest must be provided through stdin");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_STDIN_BYTES) {
      throw new BootstrapError("stdin_too_large", "Bootstrap manifest is too large");
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new BootstrapError("stdin_required", "Bootstrap manifest must be provided through stdin");
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new BootstrapError("arguments_denied", "Bootstrap accepts stdin JSON only");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readStdin());
  } catch (error) {
    if (error instanceof BootstrapError) {
      throw error;
    }
    throw new BootstrapError("invalid_json", "Bootstrap manifest is not valid JSON");
  }
  const parsed = inputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new BootstrapError("invalid_manifest", "Bootstrap manifest failed validation");
  }

  const config = loadConfig();
  if (parsed.data.mode === "production" && config.nodeEnv !== "production") {
    throw new BootstrapError("environment_mismatch", "Production ceremony requires NODE_ENV=production");
  }
  if (parsed.data.mode === "non_production_prototype" && config.nodeEnv === "production") {
    throw new BootstrapError(
      "prototype_denied_in_production",
      "Prototype bootstrap is forbidden in production",
    );
  }

  const database = createDatabase(config);
  try {
    const auth = new IdentityService(database.db, config);
    const identity = new IdentityAdminService(database.db, config, auth);
    const receipt = await database.db.transaction().execute(async (transaction) => {
      await sql`set transaction isolation level serializable`.execute(transaction);
      await sql`select pg_advisory_xact_lock(4936470199)`.execute(transaction);

      const accountCount = await transaction
        .selectFrom("identity.user_account")
        .select((expression) => expression.fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow();
      const ceremonyCount = await sql<{ count: number }>`
        select count(*)::int as count from identity.bootstrap_ceremony
      `.execute(transaction);
      if (Number(accountCount.count) !== 0 || Number(ceremonyCount.rows[0]?.count ?? 0) !== 0) {
        throw new BootstrapError("bootstrap_closed", "Identity bootstrap is already initialized");
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      const identities: Array<{
        personId: string;
        userAccountId: string;
        credentialTokenId: string;
        email: string;
      }> = [];

      for (const person of parsed.data.people) {
        const personId = newUuid();
        const userAccountId = newUuid();
        const credentialTokenId = newUuid();
        const email = person.email.trim().toLocaleLowerCase("en-US");
        const token = identity.deriveCredentialToken(credentialTokenId, "invite");
        await transaction
          .insertInto("identity.person")
          .values({
            id: personId,
            surname: person.surname,
            given_name: person.givenName,
            middle_name: person.middleName ?? null,
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
            id: userAccountId,
            person_id: personId,
            email,
            username: null,
            password_hash: null,
            account_state: "active",
            credential_state: "invited",
            risk_state: "normal",
            mfa_state: "enrollment_required",
            failed_login_count: 0,
            locked_until: null,
            created_at: now,
            updated_at: now,
            archived_at: null,
          })
          .execute();
        await transaction
          .insertInto("identity.password_token")
          .values({
            id: credentialTokenId,
            user_account_id: userAccountId,
            purpose: "invite",
            token_hash: keyedHash(token, config.session.tokenPepper),
            expires_at: expiresAt,
            used_at: null,
            revoked_at: null,
            created_by: null,
            reason: "trusted_bootstrap_ceremony",
            created_at: now,
          })
          .execute();
        identities.push({ personId, userAccountId, credentialTokenId, email });
      }

      for (const [index, account] of identities.entries()) {
        const assigner = identities.length === 2 ? identities[(index + 1) % 2] : account;
        if (!assigner) {
          throw new BootstrapError("bootstrap_invariant_failed", "Bootstrap assigner is unavailable");
        }
        await transaction
          .insertInto("identity.user_role_assignment")
          .values({
            id: newUuid(),
            user_account_id: account.userAccountId,
            role_code: "platform_superadmin",
            scope_type: "all",
            scope_id: null,
            valid_from: now,
            valid_to: null,
            assigned_by: assigner.userAccountId,
            reason: "trusted bootstrap ceremony",
            created_at: now,
            updated_at: now,
            archived_at: null,
          })
          .execute();

        const eventId = newUuid();
        await transaction
          .insertInto("platform.outbox_event")
          .values({
            id: eventId,
            topic: "identity.credential.delivery_requested",
            aggregate_type: "user_account",
            aggregate_id: account.userAccountId,
            payload: credentialDeliveryPayload({
              userAccountId: account.userAccountId,
              credentialTokenId: account.credentialTokenId,
              purpose: "invite",
            }),
            idempotency_key: `identity.bootstrap.invite:${account.userAccountId}`,
            occurred_at: now,
            available_at: now,
            attempt_count: 0,
            locked_at: null,
            locked_by: null,
            delivered_at: null,
            last_error_code: null,
          })
          .execute();
      }

      await sql`
        insert into identity.bootstrap_ceremony (
          singleton, mode, state, first_person_id, second_person_id,
          manifest_sha256, owner_approval_ref, ceremony_operator_ref,
          started_at, completed_at, closed_at
        ) values (
          true,
          ${parsed.data.mode},
          'pending_acceptance',
          ${identities[0]?.personId ?? null}::uuid,
          ${identities[1]?.personId ?? null}::uuid,
          ${parsed.data.manifestSha256},
          ${parsed.data.ownerApprovalRef},
          ${parsed.data.ceremonyOperatorRef},
          ${now},
          null,
          null
        )
      `.execute(transaction);

      await appendAuditEvent(transaction, {
        eventType: "identity.bootstrap.started",
        actorType: "trusted_ceremony",
        actorId: null,
        subjectType: "bootstrap_ceremony",
        subjectId: null,
        reason: "trusted bootstrap ceremony",
        afterState: {
          mode: parsed.data.mode,
          state: "pending_acceptance",
          futureSuperadminCount: identities.length,
        },
        metadata: {
          manifestSha256: parsed.data.manifestSha256,
          ownerApprovalRef: parsed.data.ownerApprovalRef,
          ceremonyOperatorRef: parsed.data.ceremonyOperatorRef,
        },
        policyVersion: IDENTITY_POLICY_VERSION,
        scopeSnapshot: { scope: "platform_bootstrap" },
      });

      return {
        status: "ok" as const,
        mode: parsed.data.mode,
        bootstrapState: "pending_acceptance" as const,
        invites: identities.map((account) => ({
          userAccountId: account.userAccountId,
          credentialTokenId: account.credentialTokenId,
          expiresAt: expiresAt.toISOString(),
        })),
      };
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof BootstrapError ? error.code : "bootstrap_failed";
  process.stderr.write(`${JSON.stringify({ status: "error", code })}\n`);
  process.exitCode = 1;
});
