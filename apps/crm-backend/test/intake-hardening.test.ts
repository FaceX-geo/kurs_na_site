import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NormalizedApplicationInput } from "../src/modules/intake/ports.js";
import {
  type CandidateIdentityRow,
  classifyCandidateIdentity,
} from "../src/modules/intake/routing-worker.js";
import {
  issueUploadBinding,
  keyApplicationRequestHash,
  verifyUploadBinding,
} from "../src/modules/intake/upload-binding.js";

const rootSecret = "test-only-root-secret-with-more-than-thirty-two-characters";

const personal: NormalizedApplicationInput["personal"] = {
  surname: "Иванов",
  name: "Иван",
  middlename: "Иванович",
  birthdate: "1990-06-12",
  email: "ivanov@example.com",
  phoneE164: "+79111112233",
};

function candidate(overrides: Partial<CandidateIdentityRow> = {}): CandidateIdentityRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    surname: " Иванов ",
    given_name: "ИВАН",
    middle_name: "Иванович",
    birth_date: "1990-06-12",
    normalized_email: "ivanov@example.com",
    normalized_phone: "+79111112233",
    person_archived_at: null,
    profile_id: "20000000-0000-4000-8000-000000000001",
    profile_archived_at: null,
    has_employee_profile: false,
    has_user_account: false,
    ...overrides,
  };
}

describe("public upload binding", () => {
  it("reconstructs the same opaque token and verifies only its keyed stored hash", () => {
    const first = issueUploadBinding("30000000-0000-4000-8000-000000000001", "file_public_01", rootSecret);
    const replay = issueUploadBinding("30000000-0000-4000-8000-000000000001", "file_public_01", rootSecret);

    expect(replay).toEqual(first);
    expect(first.token).toMatch(/^ub1\.[A-Za-z0-9_-]{43}$/u);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.tokenHash).not.toContain(first.token);
    expect(verifyUploadBinding(first.token, first.tokenHash, first.keyVersion, rootSecret)).toBe(true);
    expect(verifyUploadBinding(`${first.token}x`, first.tokenHash, first.keyVersion, rootSecret)).toBe(false);
  });

  it("keys the application idempotency hash by the binding without retaining the raw token", () => {
    const first = keyApplicationRequestHash("a".repeat(64), "ub1.first", rootSecret);
    const second = keyApplicationRequestHash("a".repeat(64), "ub1.second", rootSecret);

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain("ub1.first");
  });
});

describe("intake candidate identity classification", () => {
  it("reuses only one exact candidate profile match", () => {
    expect(classifyCandidateIdentity([candidate()], personal)).toEqual({
      kind: "reuse",
      personId: "10000000-0000-4000-8000-000000000001",
      profileId: "20000000-0000-4000-8000-000000000001",
    });
    expect(classifyCandidateIdentity([], personal)).toEqual({ kind: "new" });
  });

  it.each([
    { normalized_phone: "+79999999999" },
    { surname: "Петров" },
    { birth_date: "1991-06-12" },
    { profile_id: null },
    { has_employee_profile: true },
    { has_user_account: true },
    { person_archived_at: new Date("2026-01-01T00:00:00.000Z") },
  ] satisfies Array<Partial<CandidateIdentityRow>>)(
    "routes a partial, conflicting or privileged identity to stable review: %o",
    (override) => {
      expect(classifyCandidateIdentity([candidate(override)], personal)).toEqual({
        kind: "needs_review",
        reasonCode: "INTAKE_IDENTITY_MATCH_REQUIRES_REVIEW",
      });
    },
  );

  it("does not auto-merge multiple contact candidates", () => {
    expect(
      classifyCandidateIdentity(
        [candidate(), candidate({ id: "10000000-0000-4000-8000-000000000002" })],
        personal,
      ),
    ).toMatchObject({ kind: "needs_review" });
  });
});

describe("intake database guards", () => {
  it("keeps upload credentials hashed and serializes the open case invariant", async () => {
    const [up, down, worker, adapter] = await Promise.all([
      readFile(path.resolve("db/migrations/0110_intake_identity_and_case_guards.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0110_intake_identity_and_case_guards.down.sql"), "utf8"),
      readFile(path.resolve("src/modules/intake/routing-worker.ts"), "utf8"),
      readFile(path.resolve("src/modules/intake/postgres-adapter.ts"), "utf8"),
    ]);

    expect(up).toContain("binding_token_hash");
    expect(up).toContain("CREATE TABLE intake.upload_reservation");
    expect(up).toContain("one_open_case_per_profile_route_guard");
    expect(up).toContain("pg_advisory_xact_lock");
    expect(up).toContain("SECURITY DEFINER");
    expect(worker).toContain("INTAKE_OPEN_CASE_EXISTS_FOR_ROUTE");
    expect(worker).not.toContain('.leftJoin("identity.user_account');
    expect(adapter).toContain("reserveUpload(command)");
    expect(adapter).toContain("reconcileAbandonedUploadObjects");
    expect(adapter).toContain("Never delete here: COMMIT acknowledgement may be ambiguous");
    expect(down).toContain("DROP COLUMN IF EXISTS binding_token_hash");
    expect(down).toContain("DROP FUNCTION IF EXISTS crm.enforce_one_open_case_per_profile_route");
  });
});
