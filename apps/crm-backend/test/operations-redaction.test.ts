import { describe, expect, it } from "vitest";
import { renderPrometheusMetrics } from "../src/modules/operations/metrics.js";
import {
  redactAuditReason,
  redactBlockerCodes,
  redactPolicyVersion,
} from "../src/modules/operations/redaction.js";

describe("operations redaction", () => {
  it("drops human-entered audit reason and malformed policy metadata", () => {
    expect(redactAuditReason("operator email person@example.test")).toBeNull();
    expect(redactAuditReason("CUTOVER_GATE_BLOCKED")).toBe("CUTOVER_GATE_BLOCKED");
    expect(redactPolicyVersion("policy v1; token=secret")).toBeNull();
    expect(redactPolicyVersion("audit-policy:v2")).toBe("audit-policy:v2");
  });

  it("keeps only stable blocker codes", () => {
    expect(
      redactBlockerCodes([
        "REGISTRY_DRIFT",
        "REGISTRY_DRIFT",
        { code: "MIGRATION_EXECUTION_FAILED", detail: "person@example.test" },
        "phone +79990000000",
        { rawSourceRow: "must-not-leak" },
      ]),
    ).toEqual(["REGISTRY_DRIFT", "MIGRATION_EXECUTION_FAILED"]);
  });

  it("renders only closed aggregate metrics even when runtime input has extra fields", () => {
    const body = renderPrometheusMetrics({
      migrationRuns: { dryRunning: 1, failed: 2, completed: 3 },
      migrationConflicts: { openBlocking: 4, openWarning: 5 },
      outbox: { pending: 6, retrying: 7 },
      auditEvents: 8,
      secret: "database-password",
      sourceRow: { email: "person@example.test" },
    } as never);

    expect(body).toContain("crm_migration_conflicts_open_blocking 4");
    expect(body).not.toContain("database-password");
    expect(body).not.toContain("person@example.test");
    expect(body).not.toContain("sourceRow");
  });
});
