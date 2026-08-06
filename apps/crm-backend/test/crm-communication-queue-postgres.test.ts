import { createHash, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors.js";
import type { Database } from "../src/db/types.js";
import type { CrmAccessScope, CrmActorContext } from "../src/modules/crm/ports.js";
import { PostgresCrmOperationsRepository } from "../src/modules/crm-operations/adapters/postgres-crm-operations-repository.js";
import type { QueueCommunicationBody } from "../src/modules/crm-operations/contracts.js";
import type { CrmOperationsIdempotentUpdateCommand } from "../src/modules/crm-operations/ports.js";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const EPHEMERAL_DATABASE_NAME = /(?:^|[_-])(test|ephemeral|tmp)(?:[_-]|$)/iu;

function guardedTestDatabaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !LOCAL_DATABASE_HOSTS.has(parsed.hostname) ||
    !EPHEMERAL_DATABASE_NAME.test(databaseName)
  ) {
    throw new Error(
      "Refusing CRM queue integration test: TEST_DATABASE_URL must use localhost and an ephemeral test database name",
    );
  }
  return candidate;
}

const testDatabaseUrl = guardedTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

// Audit rows are append-only, so every fixture uses fresh UUIDs and can exist only in the guarded ephemeral DB.

interface SeededCommunication {
  readonly draftId: string;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
  readonly selectionFingerprint: string;
  readonly piiMarkers: readonly string[];
}

interface QueueWriteCounts {
  readonly outbox: number;
  readonly audit: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function selectionFingerprint(personIds: readonly string[]): string {
  return sha256(JSON.stringify([...personIds].sort()));
}

function compactUuid(value: string): string {
  return value.replaceAll("-", "");
}

async function seedConfirmedCommunication(db: Kysely<Database>, label: string): Promise<SeededCommunication> {
  const creatorPersonId = randomUUID();
  const creatorUserAccountId = randomUUID();
  const actorPersonId = randomUUID();
  const actorUserAccountId = randomUUID();
  const actorEmployeeProfileId = randomUUID();
  const recipientPersonIds = [randomUUID(), randomUUID()].sort();
  const caseId = randomUUID();
  const assignmentId = randomUUID();
  const draftId = randomUUID();
  const marker = compactUuid(draftId).slice(0, 12);
  const recipientSurname = `QueueRecipientPii${marker}`;
  const recipientEmail = `queue-recipient-${marker}@example.invalid`;
  const communicationBody = `PRIVATE_QUEUE_BODY_${marker}`;
  const fingerprint = selectionFingerprint(recipientPersonIds);
  const now = new Date();

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("identity.person")
      .values([
        {
          id: creatorPersonId,
          surname: "QueueCreator",
          given_name: label,
          middle_name: null,
          birth_date: null,
          normalized_email: `queue-creator-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        },
        {
          id: actorPersonId,
          surname: "QueueActor",
          given_name: label,
          middle_name: null,
          birth_date: null,
          normalized_email: `queue-actor-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        },
        ...recipientPersonIds.map((id, index) => ({
          id,
          surname: `${recipientSurname}${index + 1}`,
          given_name: "Private",
          middle_name: null,
          birth_date: null,
          normalized_email: index === 0 ? recipientEmail : `queue-recipient-2-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        })),
      ])
      .execute();

    await transaction
      .insertInto("identity.user_account")
      .values([
        {
          id: creatorUserAccountId,
          person_id: creatorPersonId,
          email: `queue-creator-${marker}@example.invalid`,
          username: null,
          password_hash: null,
          account_state: "active",
          credential_state: "invited",
          risk_state: "normal",
          mfa_state: "not_enrolled",
          failed_login_count: 0,
          locked_until: null,
          updated_at: now,
          archived_at: null,
        },
        {
          id: actorUserAccountId,
          person_id: actorPersonId,
          email: `queue-actor-${marker}@example.invalid`,
          username: null,
          password_hash: null,
          account_state: "active",
          credential_state: "invited",
          risk_state: "normal",
          mfa_state: "not_enrolled",
          failed_login_count: 0,
          locked_until: null,
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();

    await transaction
      .insertInto("identity.employee_profile")
      .values({
        id: actorEmployeeProfileId,
        person_id: actorPersonId,
        employee_number: `queue-${marker}`,
        organization_unit_id: null,
        employment_state: "active",
        updated_at: now,
        archived_at: null,
      })
      .execute();

    await transaction
      .insertInto("crm.case")
      .values({
        id: caseId,
        public_id: `case_queue_${marker}`,
        participation_id: null,
        funnel_code: "queue_integration_test",
        funnel_version: 1,
        stage_code: "confirmed",
        title: `Queue integration ${marker}`,
        status: "open",
        next_step: null,
        source_created_at: null,
        attributes: {},
        updated_at: now,
        archived_at: null,
      })
      .execute();

    await transaction
      .insertInto("crm.case_person")
      .values([
        {
          case_id: caseId,
          person_id: recipientPersonIds[0] ?? "",
          relationship_type: "candidate",
          is_primary: true,
        },
        {
          case_id: caseId,
          person_id: recipientPersonIds[1] ?? "",
          relationship_type: "household_member",
          is_primary: false,
        },
      ])
      .execute();

    await transaction
      .insertInto("crm.case_assignment")
      .values({
        id: assignmentId,
        case_id: caseId,
        employee_profile_id: actorEmployeeProfileId,
        legacy_actor_id: null,
        role: "owner",
        valid_from: now,
        valid_to: null,
        provenance: { source: "crm-queue-postgres-integration-test" },
        updated_at: now,
        archived_at: null,
      })
      .execute();

    await transaction
      .insertInto("crm.communication_draft")
      .values({
        id: draftId,
        public_id: `communication_queue_${marker}`,
        channel: "email",
        subject: `Private subject ${marker}`,
        body: communicationBody,
        selection: { recipientPersonIds },
        selection_fingerprint: fingerprint,
        state: "confirmed",
        created_by_user_account_id: creatorUserAccountId,
        confirmed_by_user_account_id: actorUserAccountId,
        confirmed_at: now,
        queued_at: null,
        updated_at: now,
        archived_at: null,
      })
      .execute();

    await transaction
      .insertInto("crm.communication_recipient")
      .values(
        recipientPersonIds.map((personId) => ({
          id: randomUUID(),
          draft_id: draftId,
          person_id: personId,
          state: "selected",
          attempt_count: 0,
          last_error_code: null,
          queued_event_id: null,
          created_at: now,
          updated_at: now,
        })),
      )
      .execute();
  });

  const actor: CrmActorContext = {
    userAccountId: actorUserAccountId,
    employeeProfileId: actorEmployeeProfileId,
    requestId: `queue-integration-${marker}`,
  };
  return {
    draftId,
    actor,
    selectionFingerprint: fingerprint,
    access: {
      visibility: "assigned",
      actorUserAccountId,
      actorEmployeeProfileId,
      employeeProfileIds: [actorEmployeeProfileId],
      teamIds: [],
      organizationUnitIds: [],
      fieldMask: [],
    },
    piiMarkers: [communicationBody, recipientSurname, recipientEmail],
  };
}

function queueCommand(
  fixture: SeededCommunication,
  idempotencyKey: string,
  requestHash: string,
  access: CrmAccessScope = fixture.access,
  reason = "Verified integration queue request",
): CrmOperationsIdempotentUpdateCommand<QueueCommunicationBody> {
  return {
    actor: fixture.actor,
    access,
    resourceId: fixture.draftId,
    expectedVersion: 1,
    idempotencyKey,
    requestHash,
    input: {
      selectionFingerprint: fixture.selectionFingerprint,
      reason,
    },
  };
}

async function queueWriteCounts(db: Kysely<Database>, draftId: string): Promise<QueueWriteCounts> {
  const [outbox, audit] = await Promise.all([
    db
      .selectFrom("platform.outbox_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("aggregate_id", "=", draftId)
      .where("topic", "=", "crm.communication.queued.v1")
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("platform.audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("subject_id", "=", draftId)
      .where("event_type", "=", "crm.communication.queued")
      .executeTakeFirstOrThrow(),
  ]);
  return { outbox: outbox.count, audit: audit.count };
}

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected operation to reject with AppError");
}

describeWithPostgres("Postgres QueueCommunication integration", () => {
  let db: Kysely<Database>;
  let repository: PostgresCrmOperationsRepository;

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: testDatabaseUrl,
          application_name: "crm-communication-queue-integration-test",
          max: 6,
        }),
      }),
    });
    repository = new PostgresCrmOperationsRepository(db);

    const migration = await db
      .selectFrom("platform.schema_migration")
      .select("version")
      .where("version", "=", "0140_crm_communication_permissions")
      .executeTakeFirst();
    expect(migration?.version).toBe("0140_crm_communication_permissions");
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it("queues once, replays exactly, rejects a changed hash, and hides an inaccessible replay", async () => {
    const fixture = await seedConfirmedCommunication(db, "replay");
    const idempotencyKey = `queue-replay-${randomUUID()}`;
    const requestHash = sha256(`queue:${fixture.draftId}:original`);
    const command = queueCommand(fixture, idempotencyKey, requestHash);

    const queued = await repository.queueCommunication(command);
    expect(queued).toMatchObject({
      replayed: false,
      value: {
        id: fixture.draftId,
        state: "queued",
        recipientCount: 2,
        deliveryBoundary: "durable_outbox_only",
        externalDeliveryState: "queued_internal",
        version: 2,
      },
    });
    expect(queued.value.queuedAt).not.toBeNull();

    const recipients = await db
      .selectFrom("crm.communication_recipient")
      .select(["state", "queued_event_id"])
      .where("draft_id", "=", fixture.draftId)
      .orderBy("person_id")
      .execute();
    expect(recipients).toHaveLength(2);
    expect(recipients.every((recipient) => recipient.state === "queued")).toBe(true);
    const queuedEventIds = new Set(recipients.map((recipient) => recipient.queued_event_id));
    expect(queuedEventIds.size).toBe(1);
    const [queuedEventId] = [...queuedEventIds];
    expect(queuedEventId).toMatch(/^[0-9a-f-]{36}$/u);

    const afterFirstWrite = await queueWriteCounts(db, fixture.draftId);
    expect(afterFirstWrite).toEqual({ outbox: 1, audit: 1 });
    const outboxEvent = await db
      .selectFrom("platform.outbox_event")
      .select("id")
      .where("aggregate_id", "=", fixture.draftId)
      .where("topic", "=", "crm.communication.queued.v1")
      .executeTakeFirstOrThrow();
    expect(queuedEventId).toBe(outboxEvent.id);

    const replay = await repository.queueCommunication(command);
    expect(replay.replayed).toBe(true);
    expect(replay.value).toEqual(queued.value);
    expect(await queueWriteCounts(db, fixture.draftId)).toEqual(afterFirstWrite);

    const changedHashError = await captureAppError(
      repository.queueCommunication(
        queueCommand(
          fixture,
          idempotencyKey,
          sha256(`queue:${fixture.draftId}:changed`),
          fixture.access,
          "Changed request using the same idempotency key",
        ),
      ),
    );
    expect(changedHashError).toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
    expect(await queueWriteCounts(db, fixture.draftId)).toEqual(afterFirstWrite);

    const narrowedAccess: CrmAccessScope = {
      ...fixture.access,
      actorEmployeeProfileId: randomUUID(),
      employeeProfileIds: [randomUUID()],
    };
    const hiddenReplayError = await captureAppError(
      repository.queueCommunication(queueCommand(fixture, idempotencyKey, requestHash, narrowedAccess)),
    );
    expect(hiddenReplayError).toMatchObject({ statusCode: 404, code: "not_found" });
    const publicError = JSON.stringify({
      statusCode: hiddenReplayError.statusCode,
      code: hiddenReplayError.code,
      message: hiddenReplayError.message,
      errors: hiddenReplayError.errors,
      details: hiddenReplayError.details,
    });
    for (const marker of fixture.piiMarkers) expect(publicError).not.toContain(marker);
    expect(await queueWriteCounts(db, fixture.draftId)).toEqual(afterFirstWrite);
  });

  it("serializes two different idempotency keys into one queue transition", async () => {
    const fixture = await seedConfirmedCommunication(db, "concurrent");
    const requestHash = sha256(`queue:${fixture.draftId}:concurrent`);
    const outcomes = await Promise.allSettled([
      repository.queueCommunication(queueCommand(fixture, `queue-a-${randomUUID()}`, requestHash)),
      repository.queueCommunication(queueCommand(fixture, `queue-b-${randomUUID()}`, requestHash)),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]?.value).toMatchObject({ replayed: false, value: { state: "queued", version: 2 } });
    expect(rejected[0]?.reason).toBeInstanceOf(AppError);
    expect(rejected[0]?.reason).toMatchObject({ statusCode: 409, code: "version_conflict" });
    expect(await queueWriteCounts(db, fixture.draftId)).toEqual({ outbox: 1, audit: 1 });

    const recipientEvents = await db
      .selectFrom("crm.communication_recipient")
      .select("queued_event_id")
      .where("draft_id", "=", fixture.draftId)
      .execute();
    expect(recipientEvents).toHaveLength(2);
    expect(new Set(recipientEvents.map((recipient) => recipient.queued_event_id)).size).toBe(1);
  });
});
