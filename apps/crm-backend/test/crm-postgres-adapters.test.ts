import { readFile } from "node:fs/promises";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/types.js";
import {
  activeTeamEmployeeProfilesQuery,
  CRM_FIELD_MASK,
  fieldMaskForPermission,
  resolveCrmAccessScope,
} from "../src/modules/crm/adapters/postgres-crm-authorization.js";
import {
  caseScopeSql,
  crmAuditEventHash,
  crmEntityIdentifierSql,
  missingCrmTransitionFields,
  sanitizeCrmProvenance,
} from "../src/modules/crm/adapters/postgres-crm-repository.js";
import {
  createCrmCaseTransitionIdempotency,
  crmCaseTransitionIdempotencyScope,
  readCrmCaseTransitionReplay,
} from "../src/modules/crm/idempotency.js";
import type { CrmAccessScope, CrmActorContext, CrmAuthorizationRequest } from "../src/modules/crm/ports.js";
import { CRM_OPERATIONS } from "../src/registry/operation-registry.js";

const actor: CrmActorContext = {
  userAccountId: "10000000-0000-4000-8000-000000000001",
  employeeProfileId: "20000000-0000-4000-8000-000000000001",
  requestId: "request-1",
};

const authorizationRequest: CrmAuthorizationRequest = {
  actor,
  operation: CRM_OPERATIONS["cases.list"],
  permissionCode: "crm.case.list",
};

function access(overrides: Partial<CrmAccessScope> = {}): CrmAccessScope {
  return {
    visibility: "assigned",
    actorUserAccountId: actor.userAccountId,
    actorEmployeeProfileId: actor.employeeProfileId,
    employeeProfileIds: [actor.employeeProfileId ?? ""],
    teamIds: [],
    organizationUnitIds: [],
    fieldMask: fieldMaskForPermission("crm.case.list"),
    ...overrides,
  };
}

const compilePool = new Pool({
  connectionString: "postgresql://compile-only:compile-only@127.0.0.1:1/compile-only",
  max: 1,
});
const compileDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: compilePool }) });

afterAll(async () => {
  await compileDb.destroy();
});

describe("Postgres CRM authorization adapter contracts", () => {
  it("resolves assigned scope without widening it", async () => {
    const result = await resolveCrmAccessScope(
      authorizationRequest,
      [{ scopeType: "assigned", scopeId: null }],
      actor.employeeProfileId,
    );

    expect(result).toMatchObject({
      visibility: "assigned",
      employeeProfileIds: [actor.employeeProfileId],
      organizationUnitIds: [],
    });
  });

  it("collects every granted department and retains an explicit assigned exception", async () => {
    const result = await resolveCrmAccessScope(
      authorizationRequest,
      [
        { scopeType: "department", scopeId: "30000000-0000-4000-8000-000000000001" },
        { scopeType: "department", scopeId: "30000000-0000-4000-8000-000000000002" },
        { scopeType: "assigned", scopeId: null },
      ],
      actor.employeeProfileId,
    );

    expect(result.visibility).toBe("department");
    expect(result.organizationUnitIds).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ]);
    expect(result.employeeProfileIds).toEqual([actor.employeeProfileId]);
  });

  it("fails closed for team scope until a membership resolver is supplied", async () => {
    await expect(
      resolveCrmAccessScope(
        authorizationRequest,
        [{ scopeType: "team", scopeId: "40000000-0000-4000-8000-000000000001" }],
        actor.employeeProfileId,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "team_scope_unavailable" });

    const result = await resolveCrmAccessScope(
      authorizationRequest,
      [{ scopeType: "team", scopeId: "40000000-0000-4000-8000-000000000001" }],
      actor.employeeProfileId,
      {
        resolveEmployeeProfileIds: async () => [
          "20000000-0000-4000-8000-000000000002",
          "20000000-0000-4000-8000-000000000003",
        ],
      },
    );
    expect(result).toMatchObject({
      visibility: "team",
      employeeProfileIds: ["20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"],
    });
  });

  it("uses operation-specific field allowlists", () => {
    expect(fieldMaskForPermission("crm.case.read")).not.toContain(CRM_FIELD_MASK.ACTIVITY_BODY_PREVIEW);
    expect(fieldMaskForPermission("crm.communication.read")).toContain(CRM_FIELD_MASK.ACTIVITY_BODY_PREVIEW);
    expect(fieldMaskForPermission("crm.employer.read")).toContain(CRM_FIELD_MASK.EMPLOYER_CONTACT_RAW);
  });

  it("expands team scope only through active, non-archived primary memberships", () => {
    const teamId = "40000000-0000-4000-8000-000000000001";
    const compiled = activeTeamEmployeeProfilesQuery(compileDb, [teamId]).compile();

    expect(compiled.sql).toContain('"organization_unit_id" in');
    expect(compiled.sql).toContain('"employment_state" =');
    expect(compiled.sql).toContain('"archived_at" is null');
    expect(compiled.parameters).toContain(teamId);
    expect(compiled.parameters).toContain("active");
  });
});

describe("Postgres CRM row-scope SQL", () => {
  it("accepts public ids without casting them to uuid and keeps both comparisons parameterized", () => {
    const identifier = "case_public_1";
    const compiled = compileDb
      .selectFrom("crm.case as case_row")
      .select("case_row.id")
      .where(crmEntityIdentifierSql("case_row", identifier))
      .compile();

    expect(compiled.sql).toContain('"case_row"."id"::text');
    expect(compiled.sql).toContain('"case_row"."public_id"');
    expect(compiled.sql).not.toContain("::uuid");
    expect(compiled.sql).not.toContain(identifier);
    expect(compiled.parameters).toEqual([identifier, identifier]);
  });

  it("parameterizes assigned employee scope inside the SQL predicate", () => {
    const compiled = compileDb
      .selectFrom("crm.case as case_row")
      .select("case_row.id")
      .where(caseScopeSql(access(), "case_row"))
      .compile();

    expect(compiled.sql).toContain("crm.case_assignment");
    expect(compiled.sql).toContain('"scope_assignment"."employee_profile_id"');
    expect(compiled.sql).not.toContain(actor.employeeProfileId ?? "never");
    expect(compiled.parameters).toContain(actor.employeeProfileId);
  });

  it("compiles department checks against employee organization units", () => {
    const departmentId = "30000000-0000-4000-8000-000000000001";
    const compiled = compileDb
      .selectFrom("crm.case as case_row")
      .select("case_row.id")
      .where(
        caseScopeSql(
          access({
            visibility: "department",
            employeeProfileIds: [],
            organizationUnitIds: [departmentId],
          }),
          "case_row",
        ),
      )
      .compile();

    expect(compiled.sql).toContain("identity.employee_profile");
    expect(compiled.sql).toContain("organization_unit_id");
    expect(compiled.parameters).toContain(departmentId);
  });

  it("does not add a row predicate for explicit all scope", () => {
    const compiled = compileDb
      .selectFrom("crm.case as case_row")
      .select("case_row.id")
      .where(caseScopeSql(access({ visibility: "all", employeeProfileIds: [] }), "case_row"))
      .compile();

    expect(compiled.sql).toContain("where true");
    expect(compiled.sql).not.toContain("crm.case_assignment");
  });
});

describe("Postgres CRM mutation invariants", () => {
  it("binds transition idempotency to actor, operation, case, version and canonical payload", () => {
    const hashingKey = "crm-idempotency-test-hashing-key-32-bytes";
    const base = {
      hashingKey,
      idempotencyKey: "transition-key-0001",
      actor,
      access: access(),
      caseId: "case-internal-1",
      expectedVersion: 3,
    } as const;
    const first = createCrmCaseTransitionIdempotency({
      ...base,
      body: { toStageCode: "qualification", evidence: { owner_id: "employee-1", next_step: "call" } },
    });
    const reordered = createCrmCaseTransitionIdempotency({
      ...base,
      body: { toStageCode: "qualification", evidence: { next_step: "call", owner_id: "employee-1" } },
    });
    const changed = createCrmCaseTransitionIdempotency({
      ...base,
      body: { toStageCode: "qualification", evidence: { owner_id: "employee-1", next_step: "email" } },
    });
    const widenedAccess = createCrmCaseTransitionIdempotency({
      ...base,
      access: access({ visibility: "all", employeeProfileIds: [] }),
      body: { toStageCode: "qualification", evidence: { owner_id: "employee-1", next_step: "call" } },
    });

    expect(first.scope).toBe(crmCaseTransitionIdempotencyScope(actor.userAccountId, base.caseId));
    expect(first.requestHash).toBe(reordered.requestHash);
    expect(first.requestHash).not.toBe(changed.requestHash);
    expect(first.requestHash).not.toBe(widenedAccess.requestHash);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("returns a stable conflict when the same transition key is bound to a different payload hash", () => {
    expect.assertions(2);
    try {
      readCrmCaseTransitionReplay(
        {
          request_hash: "a".repeat(64),
          response_status: 200,
          response_body: {},
          resource_id: "case-internal-1",
          state: "completed",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        { aggregateId: "case-internal-1", requestHash: "b".repeat(64) },
      );
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
      expect(String(error)).not.toContain("response_body");
    }
  });

  it("accepts required data from stored aggregate context or command evidence", () => {
    expect(
      missingCrmTransitionFields(
        ["owner_id", "next_step", "document_decision"],
        { document_decision: "accepted" },
        { owner_id: "employee-1", next_step: "call" },
      ),
    ).toEqual([]);
    expect(missingCrmTransitionFields(["reason", "target_state"], { reason: " " })).toEqual([
      "reason",
      "target_state",
    ]);
  });

  it("creates a deterministic order-independent audit hash", () => {
    const left = crmAuditEventHash({ eventType: "transition", after: { version: 2, state: "done" } });
    const right = crmAuditEventHash({ after: { state: "done", version: 2 }, eventType: "transition" });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns only allowlisted non-structured provenance fields", () => {
    expect(
      sanitizeCrmProvenance({
        sourceSystem: "bitrix",
        sourceId: "42",
        rawPayload: { email: "private@example.test" },
        accessToken: "secret",
      }),
    ).toEqual({ sourceSystem: "bitrix", sourceId: "42" });
  });

  it("seeds exactly the permissions used by the operation and transition registries", async () => {
    const up = await readFile(path.resolve("db/migrations/0004_crm_runtime.up.sql"), "utf8");
    const down = await readFile(path.resolve("db/migrations/0004_crm_runtime.down.sql"), "utf8");
    for (const permission of [
      "crm.case.read",
      "crm.case.list",
      "crm.case.transition",
      "crm.case.reopen",
      "crm.employer.read",
      "crm.task.read",
      "crm.task.manage",
      "crm.communication.read",
    ]) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    expect(up).toContain("case_assignment_employee_access_idx");
    expect(up).toContain("activity_referral_timeline_idx");
  });

  it("keeps history append-only and lets active checklist positions be replaced", async () => {
    const up = await readFile(
      path.resolve("db/migrations/0090_crm_history_and_checklist_invariants.up.sql"),
      "utf8",
    );
    const down = await readFile(
      path.resolve("db/migrations/0090_crm_history_and_checklist_invariants.down.sql"),
      "utf8",
    );

    expect(up).toContain("task_checklist_active_position_uidx");
    expect(up).toContain("WHERE archived_at IS NULL");
    for (const history of [
      "crm.case_stage_history",
      "crm.employer_referral_stage_history",
      "crm.task_history",
      "crm.report_run",
    ]) {
      expect(up).toContain(`ON ${history}`);
    }
    expect(up.match(/platform\.reject_mutation\(\)/gu)).toHaveLength(4);
    expect(down).toContain("task_checklist_item_task_id_position_key");
  });
});
