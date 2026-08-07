import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTestBypassSessionRevocationGate,
  TEST_BYPASS_RETIREMENT_AUDIT_EVENT,
  TEST_BYPASS_SESSION_FENCE_LOCK_KEY,
  TEST_BYPASS_SESSION_REVOCATION_CONFIRMATION,
  testBypassCleanupAuditOccurredAt,
} from "../src/modules/identity/test-bypass-session-revocation.js";

describe("test bypass session revocation and retirement fence", () => {
  it("requires bypass=false and the exact destructive confirmation phrase", () => {
    expect(() => assertTestBypassSessionRevocationGate({})).toThrowError(/explicitly set to false/u);
    expect(() =>
      assertTestBypassSessionRevocationGate({
        CRM_TEST_AUTH_BYPASS: "false",
        CRM_TEST_BYPASS_SESSION_REVOCATION_CONFIRM: "REVOKE_SOME_SESSIONS",
      }),
    ).toThrowError(/exact confirmation phrase/u);
    expect(() =>
      assertTestBypassSessionRevocationGate({
        CRM_TEST_AUTH_BYPASS: "false",
        CRM_TEST_BYPASS_SESSION_REVOCATION_CONFIRM: TEST_BYPASS_SESSION_REVOCATION_CONFIRMATION,
      }),
    ).not.toThrow();
  });

  it("targets every bypass-audited account without a mutable role predicate or credential reads", async () => {
    const source = await readFile(
      path.resolve("src/modules/identity/test-bypass-session-revocation.ts"),
      "utf8",
    );

    expect(source).toContain("identity.session.test_mfa_bypass_authenticated");
    expect(source).not.toContain("platform_superadmin");
    expect(source).not.toContain("identity.user_role_assignment");
    expect(source).toContain("appendAuditEvent(transaction");
    expect(source).toContain("conservativeAccountWideRevocation: true");
    expect(source).toContain("all_active_sessions_for_accounts_with_bypass_audit");
    expect(source).toContain(`revoke_reason = \${REVOCATION_REASON}`);
    expect(source).not.toContain("token_hash");
    expect(source).not.toContain("csrf_token_hash");
    expect(source).not.toContain("normalized_email");
    expect(source).not.toContain("normalized_phone");
  });

  it("checks the durable retirement marker under the same advisory lock before bypass issuance", async () => {
    const [fenceSource, serviceSource] = await Promise.all([
      readFile(path.resolve("src/modules/identity/test-bypass-session-revocation.ts"), "utf8"),
      readFile(path.resolve("src/modules/identity/service.ts"), "utf8"),
    ]);

    expect(fenceSource).toContain(`pg_advisory_xact_lock(\${TEST_BYPASS_SESSION_FENCE_LOCK_KEY})`);
    expect(TEST_BYPASS_SESSION_FENCE_LOCK_KEY).toBe(4_936_470_164);
    expect(fenceSource).toContain(TEST_BYPASS_RETIREMENT_AUDIT_EVENT);
    expect(serviceSource).toContain("lockAndReadTestBypassRetirementMarker(transaction)");
    expect(serviceSource).toContain('"test_auth_bypass_retired"');

    const lockAcquisition = fenceSource.indexOf("pg_advisory_xact_lock");
    const markerRead = fenceSource.indexOf('.where("event_type", "=", TEST_BYPASS_RETIREMENT_AUDIT_EVENT)');
    const sessionRevocation = fenceSource.indexOf("UPDATE identity.session AS candidate_session");
    const markerWrite = fenceSource.indexOf("eventType: TEST_BYPASS_RETIREMENT_AUDIT_EVENT");
    expect(lockAcquisition).toBeGreaterThanOrEqual(0);
    expect(markerRead).toBeGreaterThan(lockAcquisition);
    expect(sessionRevocation).toBeGreaterThan(markerRead);
    expect(markerWrite).toBeGreaterThan(sessionRevocation);

    const bypassBranch = serviceSource.indexOf("if (this.config.auth.testMfaBypass)");
    const fenceCheck = serviceSource.indexOf(
      "lockAndReadTestBypassRetirementMarker(transaction)",
      bypassBranch,
    );
    const bypassAudit = serviceSource.indexOf(
      'eventType: "identity.session.test_mfa_bypass_authenticated"',
      bypassBranch,
    );
    expect(bypassBranch).toBeGreaterThanOrEqual(0);
    expect(fenceCheck).toBeGreaterThan(bypassBranch);
    expect(bypassAudit).toBeGreaterThan(fenceCheck);
  });

  it("orders a newly-created retirement marker before its cleanup audit event", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    expect(testBypassCleanupAuditOccurredAt(now, true).toISOString()).toBe("2026-08-07T12:00:00.001Z");
    expect(testBypassCleanupAuditOccurredAt(now, false)).toBe(now);
  });
});
