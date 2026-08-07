import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/types.js";
import { PostgresCrmAuthorizationAdapter } from "../src/modules/crm/adapters/postgres-crm-authorization.js";
import { PostgresCrmRepository } from "../src/modules/crm/adapters/postgres-crm-repository.js";
import type { CrmActorContext } from "../src/modules/crm/ports.js";
import { CRM_OPERATIONS } from "../src/registry/operation-registry.js";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const EPHEMERAL_DATABASE_NAME = /(?:^|[_-])(test|ephemeral|tmp)(?:[_-]|$)/iu;

function guardedTestDatabaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const parsed = new URL(candidate);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !LOCAL_DATABASE_HOSTS.has(parsed.hostname) ||
    !EPHEMERAL_DATABASE_NAME.test(databaseName)
  ) {
    throw new Error(
      "Refusing CRM authorization integration test: TEST_DATABASE_URL must use localhost and an ephemeral test database name",
    );
  }
  return candidate;
}

const testDatabaseUrl = guardedTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

interface SeededAuthorizationFixture {
  readonly superadmin: CrmActorContext;
  readonly specialist: CrmActorContext;
  readonly unrelated: CrmActorContext;
  readonly specialistCaseId: string;
  readonly unassignedCaseId: string;
  readonly marker: string;
}

async function seedFixture(db: Kysely<Database>): Promise<SeededAuthorizationFixture> {
  const marker = randomUUID().replaceAll("-", "").slice(0, 12);
  const superadminPersonId = randomUUID();
  const superadminUserId = randomUUID();
  const specialistPersonId = randomUUID();
  const specialistUserId = randomUUID();
  const specialistEmployeeId = randomUUID();
  const unrelatedPersonId = randomUUID();
  const unrelatedUserId = randomUUID();
  const specialistCaseId = randomUUID();
  const unassignedCaseId = randomUUID();
  const now = new Date();

  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("identity.person")
      .values([
        {
          id: superadminPersonId,
          surname: "ScopeSuperadmin",
          given_name: marker,
          middle_name: null,
          birth_date: null,
          normalized_email: `scope-superadmin-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        },
        {
          id: specialistPersonId,
          surname: "ScopeSpecialist",
          given_name: marker,
          middle_name: null,
          birth_date: null,
          normalized_email: `scope-specialist-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        },
        {
          id: unrelatedPersonId,
          surname: "ScopeUnrelated",
          given_name: marker,
          middle_name: null,
          birth_date: null,
          normalized_email: `scope-unrelated-${marker}@example.invalid`,
          normalized_phone: null,
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();
    await transaction
      .insertInto("identity.user_account")
      .values([
        {
          id: superadminUserId,
          person_id: superadminPersonId,
          email: `scope-superadmin-${marker}@example.invalid`,
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
          id: specialistUserId,
          person_id: specialistPersonId,
          email: `scope-specialist-${marker}@example.invalid`,
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
          id: unrelatedUserId,
          person_id: unrelatedPersonId,
          email: `scope-unrelated-${marker}@example.invalid`,
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
        id: specialistEmployeeId,
        person_id: specialistPersonId,
        employee_number: `scope-${marker}`,
        organization_unit_id: null,
        employment_state: "active",
        updated_at: now,
        archived_at: null,
      })
      .execute();
    await transaction
      .insertInto("identity.user_role_assignment")
      .values([
        {
          id: randomUUID(),
          user_account_id: superadminUserId,
          role_code: "platform_superadmin",
          scope_type: "all",
          scope_id: null,
          valid_from: now,
          valid_to: null,
          assigned_by: superadminUserId,
          reason: "SUPER_ADMIN CRM read integration test",
          updated_at: now,
          archived_at: null,
        },
        {
          id: randomUUID(),
          user_account_id: specialistUserId,
          role_code: "crm_project_manager",
          scope_type: "assigned",
          scope_id: specialistEmployeeId,
          valid_from: now,
          valid_to: null,
          assigned_by: superadminUserId,
          reason: "SPECIALIST assigned scope integration test",
          updated_at: now,
          archived_at: null,
        },
        {
          id: randomUUID(),
          user_account_id: unrelatedUserId,
          role_code: "audit_reader",
          scope_type: "all",
          scope_id: null,
          valid_from: now,
          valid_to: null,
          assigned_by: superadminUserId,
          reason: "Unrelated role integration test",
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();
    await transaction
      .insertInto("crm.case")
      .values([
        {
          id: specialistCaseId,
          public_id: `case_scope_assigned_${marker}`,
          participation_id: null,
          funnel_code: "relocation",
          funnel_version: 1,
          stage_code: "new",
          title: `Scope ${marker} assigned`,
          status: "open",
          next_step: null,
          source_created_at: null,
          attributes: {},
          updated_at: now,
          archived_at: null,
        },
        {
          id: unassignedCaseId,
          public_id: `case_scope_unassigned_${marker}`,
          participation_id: null,
          funnel_code: "relocation",
          funnel_version: 1,
          stage_code: "new",
          title: `Scope ${marker} unassigned`,
          status: "open",
          next_step: null,
          source_created_at: null,
          attributes: {},
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();
    await transaction
      .insertInto("crm.case_assignment")
      .values({
        id: randomUUID(),
        case_id: specialistCaseId,
        employee_profile_id: specialistEmployeeId,
        legacy_actor_id: null,
        role: "owner",
        valid_from: now,
        valid_to: null,
        provenance: { source: "crm-superadmin-authorization-postgres-test" },
        updated_at: now,
        archived_at: null,
      })
      .execute();
  });

  return {
    superadmin: { userAccountId: superadminUserId, employeeProfileId: null, requestId: `sa-${marker}` },
    specialist: {
      userAccountId: specialistUserId,
      employeeProfileId: specialistEmployeeId,
      requestId: `specialist-${marker}`,
    },
    unrelated: { userAccountId: unrelatedUserId, employeeProfileId: null, requestId: `other-${marker}` },
    specialistCaseId,
    unassignedCaseId,
    marker,
  };
}

describeWithPostgres("Postgres SUPER_ADMIN CRM row scope", () => {
  let db: Kysely<Database>;
  let authorization: PostgresCrmAuthorizationAdapter;
  let repository: PostgresCrmRepository;

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: testDatabaseUrl,
          application_name: "crm-superadmin-authorization-integration-test",
          max: 2,
        }),
      }),
    });
    const migration = await db
      .selectFrom("platform.schema_migration")
      .select("version")
      .where("version", "=", "0163_superadmin_crm_read_access")
      .executeTakeFirst();
    expect(migration?.version).toBe("0163_superadmin_crm_read_access");
    authorization = new PostgresCrmAuthorizationAdapter(db);
    repository = new PostgresCrmRepository(db);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it("gives SUPER_ADMIN all cases, keeps SPECIALIST assigned, and denies an unrelated role", async () => {
    const fixture = await seedFixture(db);
    const request = (actor: CrmActorContext) => ({
      actor,
      operation: CRM_OPERATIONS["cases.list"],
      permissionCode: CRM_OPERATIONS["cases.list"].permissionCode,
    });

    const superadminAccess = await authorization.authorize(request(fixture.superadmin));
    const specialistAccess = await authorization.authorize(request(fixture.specialist));
    await expect(authorization.authorize(request(fixture.unrelated))).rejects.toMatchObject({
      statusCode: 403,
      code: "permission_denied",
    });

    expect(superadminAccess.visibility).toBe("all");
    expect(specialistAccess).toMatchObject({
      visibility: "assigned",
      employeeProfileIds: [fixture.specialist.employeeProfileId],
    });

    const query = { search: fixture.marker, cursor: undefined, limit: 20 };
    const superadminCases = await repository.listCases(superadminAccess, query);
    const specialistCases = await repository.listCases(specialistAccess, query);
    expect(new Set(superadminCases.items.map((item) => item.id))).toEqual(
      new Set([fixture.specialistCaseId, fixture.unassignedCaseId]),
    );
    expect(specialistCases.items.map((item) => item.id)).toEqual([fixture.specialistCaseId]);
  });
});
