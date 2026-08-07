import type { FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import { IdentityService } from "../src/modules/identity/service.js";

const config = loadConfig({
  NODE_ENV: "test",
  CURSOR_SIGNING_KEY: "session-business-role-cursor-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "session-business-role-pepper-at-least-32-chars",
});
const userId = "019fd7d0-6789-7000-8000-000000000001";
const personId = "019fd7d0-6789-7000-8000-000000000002";
const employeeId = "019fd7d0-6789-7000-8000-000000000003";

function createSessionDatabase(
  grants: Array<{
    assignment_id: string;
    role_code: string;
    scope_type: string;
    scope_id: string | null;
    permission_code: string | null;
    is_privileged: boolean;
  }>,
  employee?: { id: string; employment_state: string },
) {
  const insertedSessions: Record<string, unknown>[] = [];
  const database = {
    selectFrom(table: string) {
      const query = {
        innerJoin() {
          return query;
        },
        leftJoin() {
          return query;
        },
        select() {
          return query;
        },
        where() {
          return query;
        },
        async execute() {
          if (table !== "identity.user_role_assignment as assignment") {
            throw new Error(`Unexpected execute table ${table}`);
          }
          return grants;
        },
        async executeTakeFirst() {
          if (table !== "identity.employee_profile") {
            throw new Error(`Unexpected executeTakeFirst table ${table}`);
          }
          return employee;
        },
      };
      return query;
    },
    insertInto(table: string) {
      if (table !== "identity.session") throw new Error(`Unexpected insert table ${table}`);
      let values: Record<string, unknown> = {};
      const query = {
        values(next: Record<string, unknown>) {
          values = next;
          return query;
        },
        async execute() {
          insertedSessions.push(values);
        },
      };
      return query;
    },
  } as unknown as Kysely<Database>;
  return { database, insertedSessions };
}

function createAuthenticatedSessionDatabase() {
  const session = {
    id: "019fd7d0-6789-7000-8000-000000000020",
    user_account_id: userId,
    csrf_token_hash: "a".repeat(64),
    authentication_level: "fresh_mfa",
    idle_expires_at: new Date(Date.now() + 60_000),
    absolute_expires_at: new Date(Date.now() + 3_600_000),
    revoked_at: null,
    person_id: personId,
    email: "admin@example.test",
    account_state: "active",
    credential_state: "password_set",
    risk_state: "normal",
    mfa_state: "enrollment_required",
  };
  let sessionUpdates = 0;
  const database = {
    selectFrom(table: string) {
      const query = {
        innerJoin() {
          return query;
        },
        leftJoin() {
          return query;
        },
        select() {
          return query;
        },
        where() {
          return query;
        },
        async execute() {
          if (table !== "identity.user_role_assignment as assignment") {
            throw new Error(`Unexpected execute table ${table}`);
          }
          return [
            {
              assignment_id: "019fd7d0-6789-7000-8000-000000000021",
              role_code: "platform_superadmin",
              scope_type: "all",
              scope_id: null,
              permission_code: "identity.specialists.provision",
              is_privileged: true,
            },
          ];
        },
        async executeTakeFirst() {
          if (table === "identity.session as session") return session;
          if (table === "identity.employee_profile") return undefined;
          throw new Error(`Unexpected executeTakeFirst table ${table}`);
        },
      };
      return query;
    },
    updateTable(table: string) {
      if (table !== "identity.session") throw new Error(`Unexpected update table ${table}`);
      const query = {
        set() {
          return query;
        },
        where() {
          return query;
        },
        async execute() {
          sessionUpdates += 1;
        },
      };
      return query;
    },
  } as unknown as Kysely<Database>;
  return { database, sessionUpdates: () => sessionUpdates };
}

describe("session business identity", () => {
  it("returns the SUPER_ADMIN projection with effective permissions while retaining internal roles", async () => {
    const fixture = createSessionDatabase([
      {
        assignment_id: "019fd7d0-6789-7000-8000-000000000010",
        role_code: "platform_superadmin",
        scope_type: "all",
        scope_id: null,
        permission_code: "identity.specialists.provision",
        is_privileged: true,
      },
      {
        assignment_id: "019fd7d0-6789-7000-8000-000000000011",
        role_code: "audit_reader",
        scope_type: "all",
        scope_id: null,
        permission_code: "audit.events.read",
        is_privileged: true,
      },
    ]);
    const service = new IdentityService(fixture.database, config);

    const receipt = await service.createSession(
      userId,
      personId,
      "admin@example.test",
      "Администратор",
      "fresh_mfa",
    );
    expect(receipt.user).toMatchObject({
      businessRole: "SUPER_ADMIN",
      employeeProfileId: null,
      roles: expect.arrayContaining(["platform_superadmin", "audit_reader"]),
      permissions: expect.arrayContaining(["identity.specialists.provision", "audit.events.read"]),
    });
    expect(fixture.insertedSessions).toHaveLength(1);
  });

  it("binds SPECIALIST sessions to an active employee profile and rejects inactive staff before insert", async () => {
    const grants = [
      {
        assignment_id: "019fd7d0-6789-7000-8000-000000000012",
        role_code: "crm_project_manager",
        scope_type: "assigned",
        scope_id: employeeId,
        permission_code: "crm.case.list",
        is_privileged: false,
      },
    ];
    const active = createSessionDatabase(grants, { id: employeeId, employment_state: "active" });
    const activeReceipt = await new IdentityService(active.database, config).createSession(
      userId,
      personId,
      "specialist@example.test",
      "Специалист",
      "password",
    );
    expect(activeReceipt.user).toMatchObject({
      businessRole: "SPECIALIST",
      employeeProfileId: employeeId,
    });

    const inactive = createSessionDatabase(grants, { id: employeeId, employment_state: "inactive" });
    await expect(
      new IdentityService(inactive.database, config).createSession(
        userId,
        personId,
        "specialist@example.test",
        "Специалист",
        "password",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "employee_profile_inactive" });
    expect(inactive.insertedSessions).toEqual([]);
  });

  it.each([
    { scopeType: "all", scopeId: null, label: "wrong scope type" },
    {
      scopeType: "assigned",
      scopeId: "019fd7d0-6789-7000-8000-000000000099",
      label: "another employee",
    },
  ])("rejects a SPECIALIST session with $label", async ({ scopeType, scopeId }) => {
    const fixture = createSessionDatabase(
      [
        {
          assignment_id: "019fd7d0-6789-7000-8000-000000000013",
          role_code: "crm_project_manager",
          scope_type: scopeType,
          scope_id: scopeId,
          permission_code: "crm.case.list",
          is_privileged: false,
        },
      ],
      { id: employeeId, employment_state: "active" },
    );

    await expect(
      new IdentityService(fixture.database, config).createSession(
        userId,
        personId,
        "specialist@example.test",
        "Специалист",
        "password",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "specialist_scope_mismatch" });
    expect(fixture.insertedSessions).toEqual([]);
  });

  it("rejects duplicate active SPECIALIST assignments even when both point to the same employee", async () => {
    const fixture = createSessionDatabase(
      ["019fd7d0-6789-7000-8000-000000000014", "019fd7d0-6789-7000-8000-000000000015"].map(
        (assignmentId) => ({
          assignment_id: assignmentId,
          role_code: "crm_project_manager",
          scope_type: "assigned",
          scope_id: employeeId,
          permission_code: "crm.case.list",
          is_privileged: false,
        }),
      ),
      { id: employeeId, employment_state: "active" },
    );

    await expect(
      new IdentityService(fixture.database, config).createSession(
        userId,
        personId,
        "specialist@example.test",
        "Специалист",
        "password",
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "specialist_scope_mismatch" });
    expect(fixture.insertedSessions).toEqual([]);
  });

  it("keeps MFA enrollment mandatory for a privileged session outside the explicit test bypass", async () => {
    const fixture = createAuthenticatedSessionDatabase();
    const service = new IdentityService(fixture.database, config);
    const request = {
      cookies: { [config.session.cookieName]: "opaque-session-token" },
    } as FastifyRequest;

    await expect(service.authenticate(request)).rejects.toMatchObject({
      statusCode: 403,
      code: "mfa_enrollment_required",
    });
    expect(fixture.sessionUpdates()).toBe(0);
  });

  it("permits a privileged session with pending MFA only in the explicit test bypass", async () => {
    const fixture = createAuthenticatedSessionDatabase();
    const testConfig = loadConfig({
      NODE_ENV: "test",
      CRM_TEST_AUTH_BYPASS: "true",
      CURSOR_SIGNING_KEY: "session-business-role-cursor-key-at-least-32-chars",
      SESSION_TOKEN_PEPPER: "session-business-role-pepper-at-least-32-chars",
    });
    const service = new IdentityService(fixture.database, testConfig);
    const request = {
      cookies: { [testConfig.session.cookieName]: "opaque-session-token" },
    } as FastifyRequest;

    await expect(service.authenticate(request)).resolves.toMatchObject({
      userAccountId: userId,
      businessRole: "SUPER_ADMIN",
      authenticationLevel: "fresh_mfa",
    });
    expect(fixture.sessionUpdates()).toBe(1);
  });
});
