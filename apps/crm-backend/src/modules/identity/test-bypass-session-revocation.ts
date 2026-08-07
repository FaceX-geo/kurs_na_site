import { type Kysely, sql, type Transaction } from "kysely";
import type { Database } from "../../db/types.js";
import { appendAuditEvent } from "../platform/audit.js";

export const TEST_BYPASS_SESSION_REVOCATION_CONFIRMATION =
  "REVOKE_ALL_ACTIVE_SESSIONS_FOR_ACCOUNTS_WITH_TEST_BYPASS_AUDIT" as const;
export const TEST_BYPASS_RETIREMENT_AUDIT_EVENT = "identity.session.test_mfa_bypass_retired";
export const TEST_BYPASS_SESSION_FENCE_LOCK_KEY = 4_936_470_164;

const REVOCATION_REASON = "test_mfa_bypass_operator_cleanup";
const REVOCATION_POLICY_VERSION = "test-bypass-session-revocation-v2";
const BYPASS_AUDIT_EVENT = "identity.session.test_mfa_bypass_authenticated";

export class TestBypassSessionRevocationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TestBypassSessionRevocationError";
    this.code = code;
  }
}

export interface TestBypassSessionRevocationSummary {
  readonly affectedAccountCount: number;
  readonly cleanupAuditEventId: string;
  readonly retirementMarkerAuditEventId: string;
  readonly revokedSessionCount: number;
  readonly selectionPolicy: "all_active_sessions_for_accounts_with_bypass_audit";
}

export function assertTestBypassSessionRevocationGate(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.CRM_TEST_AUTH_BYPASS !== "false") {
    throw new TestBypassSessionRevocationError(
      "TEST_BYPASS_SESSION_REVOCATION_REQUIRES_BYPASS_DISABLED",
      "CRM_TEST_AUTH_BYPASS must be explicitly set to false before session revocation",
    );
  }
  if (
    environment.CRM_TEST_BYPASS_SESSION_REVOCATION_CONFIRM !== TEST_BYPASS_SESSION_REVOCATION_CONFIRMATION
  ) {
    throw new TestBypassSessionRevocationError(
      "TEST_BYPASS_SESSION_REVOCATION_CONFIRMATION_REQUIRED",
      "Test bypass session revocation requires the exact confirmation phrase",
    );
  }
}

export function testBypassCleanupAuditOccurredAt(now: Date, retirementMarkerCreated: boolean): Date {
  return retirementMarkerCreated ? new Date(now.getTime() + 1) : now;
}

export async function lockAndReadTestBypassRetirementMarker(
  transaction: Transaction<Database>,
): Promise<string | null> {
  await sql`select pg_advisory_xact_lock(${TEST_BYPASS_SESSION_FENCE_LOCK_KEY})`.execute(transaction);
  const marker = await transaction
    .selectFrom("platform.audit_event")
    .select("id")
    .where("event_type", "=", TEST_BYPASS_RETIREMENT_AUDIT_EVENT)
    .orderBy("occurred_at", "asc")
    .orderBy("id", "asc")
    .executeTakeFirst();
  return marker?.id ?? null;
}

export async function revokeTestBypassSessions(
  database: Kysely<Database>,
  now = new Date(),
): Promise<TestBypassSessionRevocationSummary> {
  return database.transaction().execute(async (transaction) => {
    const existingRetirementMarkerId = await lockAndReadTestBypassRetirementMarker(transaction);

    // identity.session has no per-session bypass provenance in the deployed schema.
    // To guarantee removal without guessing by timestamps or mutable roles, revoke
    // every active session for every account with durable bypass audit evidence.
    const revoked = await sql<{ user_account_id: string }>`
      UPDATE identity.session AS candidate_session
      SET revoked_at = ${now},
          revoke_reason = ${REVOCATION_REASON}
      WHERE candidate_session.revoked_at IS NULL
        AND candidate_session.idle_expires_at > ${now}
        AND candidate_session.absolute_expires_at > ${now}
        AND EXISTS (
          SELECT 1
          FROM platform.audit_event AS bypass_audit
          WHERE bypass_audit.actor_id = candidate_session.user_account_id
            AND bypass_audit.actor_type = 'user_account'
            AND bypass_audit.event_type = ${BYPASS_AUDIT_EVENT}
        )
      RETURNING candidate_session.user_account_id
    `.execute(transaction);
    const revokedRows = revoked.rows;
    const affectedAccountCount = new Set(revokedRows.map((row) => row.user_account_id)).size;

    const retirementMarkerCreated = existingRetirementMarkerId === null;
    const retirementMarkerAuditEventId =
      existingRetirementMarkerId ??
      (await appendAuditEvent(transaction, {
        eventType: TEST_BYPASS_RETIREMENT_AUDIT_EVENT,
        actorType: "system",
        subjectType: "identity.auth_policy",
        reason: "explicit_operator_confirmation_after_test_bypass_disabled",
        afterState: { testMfaBypassRetired: true },
        metadata: { bypassEvidenceEvent: BYPASS_AUDIT_EVENT },
        policyVersion: REVOCATION_POLICY_VERSION,
        scopeSnapshot: { authenticationMode: "test_mfa_bypass" },
        occurredAt: now,
      }));

    const cleanupAuditEventId = await appendAuditEvent(transaction, {
      eventType: "identity.session.test_mfa_bypass_sessions_revoked",
      actorType: "system",
      subjectType: "identity.session",
      reason: "explicit_operator_confirmation_after_test_bypass_disabled",
      afterState: {
        affectedAccountCount,
        revokedSessionCount: revokedRows.length,
      },
      metadata: {
        bypassEvidenceEvent: BYPASS_AUDIT_EVENT,
        conservativeAccountWideRevocation: true,
        retirementMarkerAuditEventId,
        selectionPolicy: "all_active_sessions_for_accounts_with_bypass_audit",
      },
      policyVersion: REVOCATION_POLICY_VERSION,
      scopeSnapshot: { sessionState: "active" },
      occurredAt: testBypassCleanupAuditOccurredAt(now, retirementMarkerCreated),
    });

    return {
      affectedAccountCount,
      cleanupAuditEventId,
      retirementMarkerAuditEventId,
      revokedSessionCount: revokedRows.length,
      selectionPolicy: "all_active_sessions_for_accounts_with_bypass_audit",
    };
  });
}
