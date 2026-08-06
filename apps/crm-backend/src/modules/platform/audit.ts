import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { newUuid } from "../../common/id.js";
import type { Database } from "../../db/types.js";

export interface AppendAuditEventInput {
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId?: string | null;
  readonly subjectType: string;
  readonly subjectId?: string | null;
  readonly requestId?: string | null;
  readonly reason?: string | null;
  readonly beforeState?: Readonly<Record<string, unknown>> | null;
  readonly afterState?: Readonly<Record<string, unknown>> | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly policyVersion?: string | null;
  readonly scopeSnapshot?: Readonly<Record<string, unknown>> | null;
  readonly occurredAt?: Date;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * Appends one tamper-evident audit event. The advisory lock serializes the
 * hash chain across every module that uses this helper.
 */
export async function appendAuditEvent(
  transaction: Transaction<Database>,
  input: AppendAuditEventInput,
): Promise<string> {
  await sql`select pg_advisory_xact_lock(4936470130)`.execute(transaction);
  const previous = await transaction
    .selectFrom("platform.audit_event")
    .select("event_hash")
    .orderBy("occurred_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();

  const occurredAt = input.occurredAt ?? new Date();
  const eventId = newUuid();
  const eventHash = createHash("sha256")
    .update(
      canonicalJson({
        id: eventId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        requestId: input.requestId ?? null,
        reason: input.reason ?? null,
        beforeState: input.beforeState ?? null,
        afterState: input.afterState ?? null,
        metadata: input.metadata ?? {},
        policyVersion: input.policyVersion ?? null,
        scopeSnapshot: input.scopeSnapshot ?? null,
        occurredAt: occurredAt.toISOString(),
        previousHash: previous?.event_hash ?? null,
      }),
    )
    .digest("hex");

  await transaction
    .insertInto("platform.audit_event")
    .values({
      id: eventId,
      event_type: input.eventType,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      request_id: input.requestId ?? null,
      reason: input.reason ?? null,
      before_state: input.beforeState ?? null,
      after_state: input.afterState ?? null,
      metadata: input.metadata ?? {},
      policy_version: input.policyVersion ?? null,
      scope_snapshot: input.scopeSnapshot ?? null,
      occurred_at: occurredAt,
      previous_hash: previous?.event_hash ?? null,
      event_hash: eventHash,
    })
    .execute();

  return eventId;
}
