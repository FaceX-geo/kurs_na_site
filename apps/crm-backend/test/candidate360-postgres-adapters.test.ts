import { readFile } from "node:fs/promises";
import path from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/types.js";
import { resolveCandidate360AccessScope } from "../src/modules/candidate360/adapters/postgres-candidate360-authorization.js";
import {
  candidate360DocumentScopeSql,
  candidate360PersonScopeSql,
} from "../src/modules/candidate360/adapters/postgres-candidate360-repository.js";
import type { CrmAccessScope } from "../src/modules/crm/ports.js";

const actorUserAccountId = "10000000-0000-4000-8000-000000000001";
const employeeProfileId = "20000000-0000-4000-8000-000000000001";

function access(overrides: Partial<CrmAccessScope> = {}): CrmAccessScope {
  return {
    visibility: "assigned",
    actorUserAccountId,
    actorEmployeeProfileId: employeeProfileId,
    employeeProfileIds: [employeeProfileId],
    teamIds: [],
    organizationUnitIds: [],
    fieldMask: [],
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

describe("Candidate 360 authorization and SQL scope", () => {
  it("fails closed for an unsupported self/project scope", async () => {
    await expect(
      resolveCandidate360AccessScope(
        [{ scopeType: "self", scopeId: null }],
        actorUserAccountId,
        employeeProfileId,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "permission_denied" });
  });

  it("parameterizes assigned person visibility through case assignments", () => {
    const compiled = compileDb
      .selectFrom("identity.person as person")
      .select("person.id")
      .where(candidate360PersonScopeSql(access(), sql.ref("person.id")))
      .compile();

    expect(compiled.sql).toContain("crm.case_person");
    expect(compiled.sql).toContain("crm.case_assignment");
    expect(compiled.sql).not.toContain(employeeProfileId);
    expect(compiled.parameters).toContain(employeeProfileId);
  });

  it("does not silently add a row predicate for an explicit all grant", () => {
    const compiled = compileDb
      .selectFrom("identity.person as person")
      .select("person.id")
      .where(
        candidate360PersonScopeSql(
          access({ visibility: "all", employeeProfileIds: [] }),
          sql.ref("person.id"),
        ),
      )
      .compile();

    expect(compiled.sql).toContain("where true");
    expect(compiled.sql).not.toContain("crm.case_assignment");
  });

  it("scopes a case-bound document through that exact case assignment", () => {
    const compiled = compileDb
      .selectFrom("identity.person as document_person")
      .innerJoin("crm.case_person as document_link", "document_link.person_id", "document_person.id")
      .select("document_person.id")
      .where(
        candidate360DocumentScopeSql(
          access(),
          sql.ref("document_person.id"),
          sql.ref("document_link.case_id"),
        ),
      )
      .compile();

    expect(compiled.sql).toContain('candidate360_document_case.id = "document_link"."case_id"');
    expect(compiled.sql).toContain("candidate360_document_assignment");
    expect(compiled.parameters).toContain(employeeProfileId);
  });
});

describe("Candidate 360 migration invariants", () => {
  it("creates reversible logical ledgers and immutable history without identity mutation", async () => {
    const up = await readFile(path.resolve("db/migrations/0040_candidate_360.up.sql"), "utf8");
    const down = await readFile(path.resolve("db/migrations/0040_candidate_360.down.sql"), "utf8");

    for (const permission of [
      "crm.candidate.duplicates.read",
      "crm.candidate.merge",
      "crm.candidate.recommender.link",
      "crm.candidate.document.review",
    ]) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    expect(up).toContain("CREATE TABLE crm.candidate_merge");
    expect(up).toContain("state IN ('active', 'reverted')");
    expect(up).toContain("candidate_merge_history_append_only");
    expect(up).toContain("candidate_recommender_link_history_append_only");
    expect(up).toContain("candidate_document_review_append_only");
    expect(up).toContain("candidate_merge_employee_identity_check");
    expect(up).toContain("employee_profile_candidate_merge_check");
    expect(up).not.toMatch(/(?:UPDATE|DELETE\s+FROM)\s+identity\.person/i);
  });

  it("keeps participant locking in the merge transaction to prevent concurrent merge chains", async () => {
    const source = await readFile(
      path.resolve("src/modules/candidate360/adapters/postgres-candidate360-repository.ts"),
      "utf8",
    );
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("lockCandidateMergeParticipants(transaction");
  });

  it("bridges one intake upload to one active candidate document without copying the storage key", async () => {
    const [up, down, worker] = await Promise.all([
      readFile(path.resolve("db/migrations/0100_candidate_document_intake.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0100_candidate_document_intake.down.sql"), "utf8"),
      readFile(path.resolve("src/modules/intake/routing-worker.ts"), "utf8"),
    ]);

    for (const permission of [
      "crm.candidate.document.read",
      "crm.candidate.document.download",
      "crm.candidate.recommender.read",
    ]) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    expect(up).toContain("candidate_document_active_upload_uidx");
    expect(worker).toContain("insert into crm.candidate_document");
    expect(worker).toContain("intake-upload:");
    expect(worker).not.toContain("sourceUpload.storage_key");
    expect(worker).toContain("candidate360.document.created.v1");
  });

  it("keeps document content behind SQL scope, a clean-scan recheck, and metadata-only audit", async () => {
    const source = await readFile(
      path.resolve("src/modules/candidate360/adapters/postgres-candidate360-repository.ts"),
      "utf8",
    );
    expect(source).toContain("upload.scan_state = 'clean'");
    expect(source).toContain("candidate360.document.content_accessed");
    expect(source).toContain("metadata: {}");
    expect(source).toContain("candidate360DocumentScopeSql");
    expect(source).toMatch(/select scan_state[\s\S]*from intake\.upload[\s\S]*for update/u);
  });
});
