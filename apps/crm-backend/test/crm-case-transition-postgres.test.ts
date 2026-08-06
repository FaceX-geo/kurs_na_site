import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors.js";
import type { Database } from "../src/db/types.js";
import { PostgresCrmRepository } from "../src/modules/crm/adapters/postgres-crm-repository.js";
import type { CrmCaseTransitionBody } from "../src/modules/crm/contracts.js";
import { createCrmCaseTransitionIdempotency } from "../src/modules/crm/idempotency.js";
import type {
  CrmAccessScope,
  CrmActorContext,
  CrmCaseTransitionExecution,
} from "../src/modules/crm/ports.js";
import { CRM_STATE_REGISTRY } from "../src/registry/crm-state-registry.js";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const EPHEMERAL_DATABASE_NAME = /(?:^|[_-])(test|ephemeral|tmp)(?:[_-]|$)/iu;
const HASHING_KEY = "crm-transition-postgres-test-key-32-bytes";

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
      "Refusing CRM transition integration test: TEST_DATABASE_URL must use localhost and an ephemeral test database name",
    );
  }
  return candidate;
}

const testDatabaseUrl = guardedTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

interface SeededCase {
  readonly caseId: string;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

async function seedAssignedCase(db: Kysely<Database>): Promise<SeededCase> {
  const personId = randomUUID();
  const userAccountId = randomUUID();
  const employeeProfileId = randomUUID();
  const caseId = randomUUID();
  const marker = caseId.replaceAll("-", "").slice(0, 12);
  const now = new Date();

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("identity.person")
      .values({
        id: personId,
        surname: "TransitionActor",
        given_name: marker,
        middle_name: null,
        birth_date: null,
        normalized_email: `transition-${marker}@example.invalid`,
        normalized_phone: null,
        updated_at: now,
        archived_at: null,
      })
      .execute();
    await transaction
      .insertInto("identity.user_account")
      .values({
        id: userAccountId,
        person_id: personId,
        email: `transition-${marker}@example.invalid`,
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
      })
      .execute();
    await transaction
      .insertInto("identity.employee_profile")
      .values({
        id: employeeProfileId,
        person_id: personId,
        employee_number: `transition-${marker}`,
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
        public_id: `case_transition_${marker}`,
        participation_id: null,
        funnel_code: "relocation",
        funnel_version: 1,
        stage_code: "new",
        title: `Transition integration ${marker}`,
        status: "open",
        next_step: "Позвонить кандидату",
        source_created_at: null,
        attributes: {},
        updated_at: now,
        archived_at: null,
      })
      .execute();
    await transaction
      .insertInto("crm.case_assignment")
      .values({
        id: randomUUID(),
        case_id: caseId,
        employee_profile_id: employeeProfileId,
        legacy_actor_id: null,
        role: "owner",
        valid_from: now,
        valid_to: null,
        provenance: { source: "crm-case-transition-postgres-test" },
        updated_at: now,
        archived_at: null,
      })
      .execute();
  });

  const actor: CrmActorContext = {
    userAccountId,
    employeeProfileId,
    requestId: `transition-request-${marker}`,
  };
  return {
    caseId,
    actor,
    access: {
      visibility: "assigned",
      actorUserAccountId: userAccountId,
      actorEmployeeProfileId: employeeProfileId,
      employeeProfileIds: [employeeProfileId],
      teamIds: [],
      organizationUnitIds: [],
      fieldMask: [],
    },
  };
}

function command(
  fixture: SeededCase,
  idempotencyKey: string,
  body: CrmCaseTransitionBody = { toStageCode: "qualification" },
  expectedVersion = 1,
  access: CrmAccessScope = fixture.access,
): CrmCaseTransitionExecution {
  const resolved = CRM_STATE_REGISTRY.resolveTransition("case", "relocation", 1, "new", "qualification");
  if (!resolved) throw new Error("Relocation qualify transition is missing from registry");
  return {
    aggregateId: fixture.caseId,
    expectedVersion,
    fromState: "new",
    toState: "qualification",
    machineCode: "relocation",
    machineVersion: 1,
    transition: resolved.transition,
    targetAggregateStatus: "open",
    reasonCode: body.reasonCode ?? null,
    reasonText: body.reasonText ?? null,
    evidence: {
      ...(body.evidence ?? {}),
      target_state: body.toStageCode,
      ...(body.reasonCode ? { reason_code: body.reasonCode } : {}),
      ...(body.reasonText ? { reason: body.reasonText } : {}),
    },
    actor: fixture.actor,
    access,
    idempotency: createCrmCaseTransitionIdempotency({
      hashingKey: HASHING_KEY,
      idempotencyKey,
      actor: fixture.actor,
      access,
      caseId: fixture.caseId,
      expectedVersion,
      body,
    }),
  };
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

describeWithPostgres("Postgres TransitionCase idempotency", () => {
  let db: Kysely<Database>;
  let repository: PostgresCrmRepository;

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: testDatabaseUrl,
          application_name: "crm-case-transition-integration-test",
          max: 4,
        }),
      }),
    });
    repository = new PostgresCrmRepository(db, { idempotencyTtlSeconds: 3_600 });
    const migration = await db
      .selectFrom("platform.schema_migration")
      .select("version")
      .where("version", "=", "0160_business_roles_and_specialist_provisioning")
      .executeTakeFirst();
    expect(migration?.version).toBe("0160_business_roles_and_specialist_provisioning");
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it("stores one authoritative receipt, replays it exactly and preserves optimistic locking", async () => {
    const fixture = await seedAssignedCase(db);
    const idempotencyKey = `transition-${randomUUID()}`;
    const original = command(fixture, idempotencyKey);

    const first = await repository.transitionCase(original);
    expect(first.kind).toBe("updated");
    if (first.kind !== "updated") throw new Error("Expected the first transition to succeed");
    expect(first.value.replayed).toBe(false);
    expect(first.value.value).toMatchObject({
      case: { id: fixture.caseId, stageCode: "qualification", version: 2 },
      receipt: {
        id: expect.any(String),
        auditEventId: expect.any(String),
        operationId: "TransitionCase",
        requestId: fixture.actor.requestId,
        caseId: fixture.caseId,
        version: 2,
      },
    });
    expect(first.value.value.receipt.id).toBe(first.value.value.receipt.auditEventId);

    const record = await db
      .selectFrom("platform.idempotency_record")
      .select(["scope", "request_hash", "response_status", "response_body", "resource_id", "state"])
      .where("scope", "=", original.idempotency.scope)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirstOrThrow();
    expect(record).toMatchObject({
      scope: `crm.case.transition:${fixture.actor.userAccountId}:${fixture.caseId}`,
      request_hash: original.idempotency.requestHash,
      response_status: 200,
      resource_id: fixture.caseId,
      state: "completed",
    });
    expect(record.response_body).toEqual(first.value.value);

    const replay = await repository.transitionCase(original);
    expect(replay).toEqual({
      kind: "updated",
      value: { value: first.value.value, replayed: true },
    });

    const changedPayloadError = await captureAppError(
      repository.transitionCase(
        command(fixture, idempotencyKey, {
          toStageCode: "qualification",
          reasonText: "Изменённый payload с тем же ключом",
        }),
      ),
    );
    expect(changedPayloadError).toMatchObject({ statusCode: 409, code: "idempotency_conflict" });

    const staleKey = `transition-stale-${randomUUID()}`;
    const stale = await repository.transitionCase(command(fixture, staleKey));
    expect(stale).toEqual({ kind: "version_conflict", currentVersion: 2 });
    const staleClaim = await db
      .selectFrom("platform.idempotency_record")
      .select("state")
      .where("scope", "=", original.idempotency.scope)
      .where("idempotency_key", "=", staleKey)
      .executeTakeFirst();
    expect(staleClaim).toBeUndefined();

    const hiddenAccess: CrmAccessScope = {
      ...fixture.access,
      actorEmployeeProfileId: randomUUID(),
      employeeProfileIds: [randomUUID()],
    };
    const hiddenReplayError = await captureAppError(
      repository.transitionCase(command(fixture, idempotencyKey, undefined, 1, hiddenAccess)),
    );
    expect(hiddenReplayError).toMatchObject({ statusCode: 404, code: "not_found" });

    const [history, audit, outbox] = await Promise.all([
      db
        .selectFrom("crm.case_stage_history")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("case_id", "=", fixture.caseId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("platform.audit_event")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("subject_id", "=", fixture.caseId)
        .where("event_type", "=", "crm.case.transitioned")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("platform.outbox_event")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("aggregate_id", "=", fixture.caseId)
        .where("topic", "=", "crm.case.transitioned.v1")
        .executeTakeFirstOrThrow(),
    ]);
    expect({ history: history.count, audit: audit.count, outbox: outbox.count }).toEqual({
      history: 1,
      audit: 1,
      outbox: 1,
    });
  });
});
