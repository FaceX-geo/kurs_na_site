import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import { IdentityAdminService } from "../src/modules/identity/admin-service.js";
import type { AuthContext, IdentityService } from "../src/modules/identity/service.js";
import { createSpecialistProvisioningIdempotency } from "../src/modules/identity/specialist-provisioning-idempotency.js";

vi.mock("../src/modules/platform/audit.js", () => ({
  appendAuditEvent: vi.fn(async () => "019fd7d0-6789-7000-8000-000000000090"),
}));

const config = loadConfig({
  NODE_ENV: "test",
  CURSOR_SIGNING_KEY: "specialist-provisioning-cursor-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "specialist-provisioning-pepper-at-least-32-chars",
  CREDENTIAL_DELIVERY_TOKEN_SECRET: "specialist-delivery-secret-at-least-32-chars",
});
const actorId = "019fd7d0-6789-7000-8000-000000000001";
const employeeId = "019fd7d0-6789-7000-8000-000000000002";
const personId = "019fd7d0-6789-7000-8000-000000000003";

function superadmin(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    sessionId: "019fd7d0-6789-7000-8000-000000000004",
    userAccountId: actorId,
    personId: "019fd7d0-6789-7000-8000-000000000005",
    email: "admin@example.test",
    authenticationLevel: "fresh_mfa",
    csrfTokenHash: "a".repeat(64),
    roles: ["platform_superadmin"],
    permissions: ["identity.employees.read", "identity.specialists.provision"],
    businessRole: "SUPER_ADMIN",
    employeeProfileId: null,
    ...overrides,
  };
}

interface FixtureOptions {
  readonly employee?: {
    id: string;
    person_id: string;
    employment_state: string;
    employee_archived_at: Date | null;
    normalized_email: string | null;
    person_archived_at: Date | null;
  } | null;
  readonly accountForEmployee?: { id: string } | null;
  readonly accountForEmail?: { id: string } | null;
  readonly otherPerson?: { id: string } | null;
  readonly failInsertTable?: string;
}

function createProvisioningDatabase(options: FixtureOptions = {}) {
  const employee =
    options.employee === undefined
      ? {
          id: employeeId,
          person_id: personId,
          employment_state: "active",
          employee_archived_at: null,
          normalized_email: null,
          person_archived_at: null,
        }
      : options.employee;
  const committedWrites: Array<{ table: string; values: Record<string, unknown> }> = [];
  let transactionCalls = 0;
  let employeeLockCalls = 0;
  let storedIdempotency: Record<string, unknown> | null = null;

  const database = {
    transaction() {
      return {
        async execute<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
          transactionCalls += 1;
          const pendingWrites: Array<{ table: string; values: Record<string, unknown> }> = [];
          let transactionIdempotency = storedIdempotency ? { ...storedIdempotency } : null;
          const transaction = {
            selectFrom(table: string) {
              let predicateColumn = "";
              const query = {
                innerJoin() {
                  return query;
                },
                select() {
                  return query;
                },
                where(column?: string) {
                  if (typeof column === "string" && !predicateColumn) predicateColumn = column;
                  return query;
                },
                forUpdate() {
                  if (table === "identity.employee_profile as employee") employeeLockCalls += 1;
                  return query;
                },
                async executeTakeFirst() {
                  if (table === "platform.idempotency_record") {
                    return transactionIdempotency ?? undefined;
                  }
                  if (table === "identity.employee_profile as employee") return employee ?? undefined;
                  if (table === "identity.user_account") {
                    const committedAccount = committedWrites.find(
                      (write) => write.table === "identity.user_account",
                    );
                    return predicateColumn === "person_id"
                      ? (options.accountForEmployee ?? committedAccount?.values ?? undefined)
                      : (options.accountForEmail ?? committedAccount?.values ?? undefined);
                  }
                  if (table === "identity.person") return options.otherPerson ?? undefined;
                  throw new Error(`Unexpected select table ${table}`);
                },
                async executeTakeFirstOrThrow() {
                  const value = await query.executeTakeFirst();
                  if (!value) throw new Error(`Missing row for ${table}`);
                  return value;
                },
              };
              return query;
            },
            updateTable(table: string) {
              let values: Record<string, unknown> = {};
              const query = {
                set(next: Record<string, unknown>) {
                  values = next;
                  return query;
                },
                where() {
                  return query;
                },
                async execute() {
                  if (table === "platform.idempotency_record") {
                    if (!transactionIdempotency) {
                      return;
                    }
                    transactionIdempotency = { ...transactionIdempotency, ...values };
                  }
                  pendingWrites.push({ table, values });
                },
                async executeTakeFirst() {
                  await query.execute();
                  return { numUpdatedRows: table === "platform.idempotency_record" ? 1n : 0n };
                },
              };
              return query;
            },
            insertInto(table: string) {
              let values: Record<string, unknown> = {};
              const query = {
                values(next: Record<string, unknown>) {
                  values = next;
                  return query;
                },
                onConflict(callback: (conflict: unknown) => unknown) {
                  const conflict = {
                    columns() {
                      return {
                        doNothing() {
                          return conflict;
                        },
                      };
                    },
                  };
                  callback(conflict);
                  return query;
                },
                returning() {
                  return query;
                },
                async execute() {
                  if (options.failInsertTable === table) throw new Error(`Failed insert ${table}`);
                  pendingWrites.push({ table, values });
                },
                async executeTakeFirst() {
                  if (table !== "platform.idempotency_record") {
                    await query.execute();
                    return values;
                  }
                  if (transactionIdempotency) return undefined;
                  transactionIdempotency = { ...values };
                  pendingWrites.push({ table, values });
                  return { idempotency_key: values.idempotency_key };
                },
              };
              return query;
            },
          };
          const result = await callback(transaction);
          storedIdempotency = transactionIdempotency;
          committedWrites.push(...pendingWrites);
          return result;
        },
      };
    },
  } as unknown as Kysely<Database>;

  return {
    database,
    committedWrites,
    transactionCalls: () => transactionCalls,
    employeeLockCalls: () => employeeLockCalls,
    storedIdempotency: () => storedIdempotency,
  };
}

function service(fixture: ReturnType<typeof createProvisioningDatabase>): IdentityAdminService {
  return new IdentityAdminService(fixture.database, config, {} as IdentityService);
}

function createEmployeeListDatabase() {
  const whereCalls: unknown[][] = [];
  const orderByCalls: unknown[][] = [];
  const rows = [
    {
      employee_profile_id: employeeId,
      person_id: personId,
      employee_number: "EMP-001",
      organization_unit_id: null,
      employment_state: "active",
      created_at: new Date("2026-08-06T12:00:00.000Z"),
      given_name: "Иван",
      surname: "Иванов",
      middle_name: "Иванович",
      normalized_email: "specialist@example.test",
    },
  ];
  const database = {
    selectFrom(table: string) {
      if (table !== "identity.employee_profile as employee") {
        throw new Error(`Unexpected list table ${table}`);
      }
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
        where(...args: unknown[]) {
          whereCalls.push(args);
          return query;
        },
        orderBy(...args: unknown[]) {
          orderByCalls.push(args);
          return query;
        },
        limit() {
          return query;
        },
        async execute() {
          return rows;
        },
      };
      return query;
    },
  } as unknown as Kysely<Database>;
  return { database, whereCalls, orderByCalls };
}

const input = {
  employeeProfileId: employeeId,
  email: "specialist@example.test",
  reason: "Создание специалиста из кадрового реестра",
};
const idempotencyKey = "specialist-provision-0001";

describe("specialist provisioning", () => {
  it("binds the request digest to actor, operation, employee, normalized payload and access", () => {
    const original = createSpecialistProvisioningIdempotency({
      hashingKey: config.piiHashingKey,
      idempotencyKey,
      actor: superadmin(),
      payload: input,
    });
    const normalizedReplay = createSpecialistProvisioningIdempotency({
      hashingKey: config.piiHashingKey,
      idempotencyKey,
      actor: superadmin({
        roles: ["platform_superadmin", "platform_superadmin"],
        permissions: ["identity.specialists.provision", "identity.employees.read"],
      }),
      payload: { ...input, email: " SPECIALIST@EXAMPLE.TEST ", reason: ` ${input.reason} ` },
    });
    const changedActor = createSpecialistProvisioningIdempotency({
      hashingKey: config.piiHashingKey,
      idempotencyKey,
      actor: superadmin({ userAccountId: "019fd7d0-6789-7000-8000-000000000099" }),
      payload: input,
    });
    const changedEmployee = createSpecialistProvisioningIdempotency({
      hashingKey: config.piiHashingKey,
      idempotencyKey,
      actor: superadmin(),
      payload: { ...input, employeeProfileId: "019fd7d0-6789-7000-8000-000000000098" },
    });
    const changedAccess = createSpecialistProvisioningIdempotency({
      hashingKey: config.piiHashingKey,
      idempotencyKey,
      actor: superadmin({ permissions: ["identity.specialists.provision"] }),
      payload: input,
    });

    expect(original.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(normalizedReplay).toEqual(original);
    expect(changedActor.scope).not.toBe(original.scope);
    expect(changedActor.requestHash).not.toBe(original.requestHash);
    expect(changedEmployee.requestHash).not.toBe(original.requestHash);
    expect(changedAccess.requestHash).not.toBe(original.requestHash);
  });

  it("lists only active employees without an account using one stable keyset query", async () => {
    const fixture = createEmployeeListDatabase();
    const registry = new IdentityAdminService(fixture.database, config, {} as IdentityService);
    const page = await registry.listProvisionableEmployees(superadmin(), { limit: 20 });

    expect(page).toEqual({
      items: [
        expect.objectContaining({
          employeeProfileId: employeeId,
          personId,
          displayName: "Иван Иванович Иванов",
          employmentState: "active",
        }),
      ],
      page: { limit: 20, hasMore: false, nextCursor: null },
    });
    expect(fixture.whereCalls).toEqual(
      expect.arrayContaining([
        ["employee.employment_state", "=", "active"],
        ["employee.archived_at", "is", null],
        ["account.id", "is", null],
      ]),
    );
    expect(fixture.orderByCalls).toEqual([
      ["employee.created_at", "desc"],
      ["employee.id", "desc"],
    ]);
  });

  it("reuses the employee person and writes account, assigned role, invite and outbox in one transaction", async () => {
    const fixture = createProvisioningDatabase();
    const result = await service(fixture).provisionSpecialist(superadmin(), input, idempotencyKey, {
      requestId: "request-1",
    });
    const receipt = result.receipt;

    expect(result.replayed).toBe(false);
    expect(receipt).toMatchObject({
      operationId: "ProvisionSpecialist",
      employeeProfileId: employeeId,
      businessRole: "SPECIALIST",
      credentialDelivery: "queued_internal",
    });
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.employeeLockCalls()).toBe(1);
    const account = fixture.committedWrites.find((write) => write.table === "identity.user_account");
    const assignment = fixture.committedWrites.find(
      (write) => write.table === "identity.user_role_assignment",
    );
    expect(account?.values).toMatchObject({ person_id: personId, credential_state: "invited" });
    expect(assignment?.values).toMatchObject({
      user_account_id: receipt.userId,
      role_code: "crm_project_manager",
      scope_type: "assigned",
      scope_id: employeeId,
      assigned_by: actorId,
    });
    expect(fixture.committedWrites.map((write) => write.table)).toEqual(
      expect.arrayContaining([
        "identity.person",
        "identity.user_account",
        "identity.user_role_assignment",
        "identity.password_token",
        "platform.outbox_event",
      ]),
    );
    const outbox = fixture.committedWrites.find((write) => write.table === "platform.outbox_event");
    expect(outbox?.values.payload).toEqual({
      userAccountId: receipt.userId,
      credentialTokenId: expect.any(String),
      purpose: "invite",
    });
    expect(JSON.stringify(outbox?.values.payload)).not.toContain(input.email);
    expect(fixture.storedIdempotency()).toMatchObject({
      state: "completed",
      response_status: 202,
      resource_id: receipt.userId,
      response_body: receipt,
    });
  });

  it("returns the authoritative stored receipt on an exact replay after a lost response", async () => {
    const fixture = createProvisioningDatabase();
    const registry = service(fixture);
    const first = await registry.provisionSpecialist(superadmin(), input, idempotencyKey, {
      requestId: "request-lost-response",
    });
    const writesAfterFirstAttempt = fixture.committedWrites.length;

    const replay = await registry.provisionSpecialist(
      superadmin({
        roles: ["platform_superadmin", "platform_superadmin"],
        permissions: ["identity.specialists.provision", "identity.employees.read"],
      }),
      { ...input, email: "  SPECIALIST@EXAMPLE.TEST  ", reason: `  ${input.reason}  ` },
      idempotencyKey,
      { requestId: "request-retry" },
    );

    expect(replay).toEqual({ receipt: first.receipt, replayed: true });
    expect(replay.receipt.requestId).toBe("request-lost-response");
    expect(fixture.transactionCalls()).toBe(2);
    expect(fixture.employeeLockCalls()).toBe(1);
    expect(fixture.committedWrites).toHaveLength(writesAfterFirstAttempt);
  });

  it("rejects reuse of the actor-bound key for a different employee payload", async () => {
    const fixture = createProvisioningDatabase();
    const registry = service(fixture);
    await registry.provisionSpecialist(superadmin(), input, idempotencyKey, {
      requestId: "request-original",
    });

    await expect(
      registry.provisionSpecialist(
        superadmin(),
        { ...input, reason: "Другая бизнес-причина создания специалиста" },
        idempotencyKey,
        { requestId: "request-conflict" },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
    expect(fixture.employeeLockCalls()).toBe(1);
  });

  it("rejects malformed idempotency keys before opening a transaction", async () => {
    const fixture = createProvisioningDatabase();
    await expect(
      service(fixture).provisionSpecialist(superadmin(), input, "short", {
        requestId: "request-invalid-key",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_idempotency_key" });
    expect(fixture.transactionCalls()).toBe(0);
  });

  it("requires both the SUPER_ADMIN product role and a fresh MFA session before opening a transaction", async () => {
    const fixture = createProvisioningDatabase();
    await expect(
      service(fixture).provisionSpecialist(
        superadmin({ businessRole: "SPECIALIST", authenticationLevel: "fresh_mfa" }),
        input,
        idempotencyKey,
        { requestId: "request-2" },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "business_role_denied" });
    await expect(
      service(fixture).provisionSpecialist(
        superadmin({ authenticationLevel: "mfa" }),
        input,
        idempotencyKey,
        { requestId: "request-3" },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "fresh_mfa_required" });
    expect(fixture.transactionCalls()).toBe(0);
  });

  it.each([
    {
      name: "inactive employee",
      fixture: createProvisioningDatabase({
        employee: {
          id: employeeId,
          person_id: personId,
          employment_state: "inactive",
          employee_archived_at: null,
          normalized_email: null,
          person_archived_at: null,
        },
      }),
      code: "employee_not_active",
    },
    {
      name: "existing employee account",
      fixture: createProvisioningDatabase({ accountForEmployee: { id: "existing" } }),
      code: "employee_account_exists",
    },
    {
      name: "identity mismatch",
      fixture: createProvisioningDatabase({
        employee: {
          id: employeeId,
          person_id: personId,
          employment_state: "active",
          employee_archived_at: null,
          normalized_email: "another@example.test",
          person_archived_at: null,
        },
      }),
      code: "employee_identity_mismatch",
    },
  ])("rejects $name without committing partial writes", async ({ fixture, code }) => {
    await expect(
      service(fixture).provisionSpecialist(superadmin(), input, idempotencyKey, {
        requestId: `request-${code}`,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code });
    expect(fixture.committedWrites).toEqual([]);
  });

  it("rolls back account, role and invite if the outbox write fails", async () => {
    const fixture = createProvisioningDatabase({ failInsertTable: "platform.outbox_event" });
    await expect(
      service(fixture).provisionSpecialist(superadmin(), input, idempotencyKey, {
        requestId: "request-rollback",
      }),
    ).rejects.toThrow("Failed insert platform.outbox_event");
    expect(fixture.transactionCalls()).toBe(1);
    expect(fixture.committedWrites).toEqual([]);
  });
});
