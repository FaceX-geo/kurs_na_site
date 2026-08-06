import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  reconcileLegacyStaffAssociations,
  type StaffAssociationPgClient,
  type StaffAssociationReconciliationSummary,
  summarizeStaffAssociationReconciliation,
} from "../src/modules/migration/staff-association-reconciliation.js";
import { assertStaffAssociationReleaseGate } from "../src/modules/migration/staff-association-release-gate.js";

const reconciledRow: Record<
  | "active_linked_specialists"
  | "associated_legacy_task_rows"
  | "assignment_rows"
  | "case_association_review_rows"
  | "inactive_or_archived_owner_assignment_rows"
  | "legacy_assignment_rows"
  | "legacy_only_assignment_rows"
  | "legacy_task_rows"
  | "matched_staff_assignment_rows"
  | "mismatched_staff_assignment_rows"
  | "ownerless_active_cases"
  | "queued_case_review_rows"
  | "queued_unassociated_task_rows"
  | "resolvable_legacy_only_rows"
  | "unassociated_legacy_task_rows"
  | "valid_active_owner_assignment_rows",
  number
> = {
  active_linked_specialists: 8,
  associated_legacy_task_rows: 37,
  assignment_rows: 1_237,
  case_association_review_rows: 1,
  inactive_or_archived_owner_assignment_rows: 0,
  legacy_assignment_rows: 1_237,
  legacy_only_assignment_rows: 0,
  legacy_task_rows: 38,
  matched_staff_assignment_rows: 1_237,
  mismatched_staff_assignment_rows: 0,
  ownerless_active_cases: 1,
  queued_case_review_rows: 1,
  queued_unassociated_task_rows: 1,
  resolvable_legacy_only_rows: 0,
  unassociated_legacy_task_rows: 1,
  valid_active_owner_assignment_rows: 1_237,
} as const;

function summary(
  backfilledRows: number,
  row: typeof reconciledRow = reconciledRow,
): StaffAssociationReconciliationSummary {
  return summarizeStaffAssociationReconciliation(row, backfilledRows);
}

describe("legacy staff association reconciliation", () => {
  it("surfaces known owner and task gaps as durable review-required state", () => {
    expect(summary(1_237)).toEqual({
      backfilledRows: 1_237,
      counts: {
        activeLinkedSpecialists: 8,
        associatedLegacyTaskRows: 37,
        assignmentRows: 1_237,
        caseAssociationReviewRows: 1,
        inactiveOrArchivedOwnerAssignmentRows: 0,
        legacyAssignmentRows: 1_237,
        legacyOnlyAssignmentRows: 0,
        legacyTaskRows: 38,
        matchedStaffAssignmentRows: 1_237,
        mismatchedStaffAssignmentRows: 0,
        ownerlessActiveCases: 1,
        queuedCaseReviewRows: 1,
        queuedUnassociatedTaskRows: 1,
        resolvableLegacyOnlyRows: 0,
        unassociatedLegacyTaskRows: 1,
        validActiveOwnerAssignmentRows: 1_237,
      },
      ownerQueueCoverageComplete: true,
      ownerlessCasesRequireReview: true,
      queueCoverageComplete: true,
      status: "review_required",
      taskQueueCoverageComplete: true,
      unassociatedTasksRequireReview: true,
    });
  });

  it("never treats an inactive or archived employee owner as valid coverage", () => {
    expect(
      summarizeStaffAssociationReconciliation(
        {
          ...reconciledRow,
          case_association_review_rows: 2,
          inactive_or_archived_owner_assignment_rows: 1,
          ownerless_active_cases: 2,
          queued_case_review_rows: 2,
          valid_active_owner_assignment_rows: 1_236,
        },
        0,
      ),
    ).toMatchObject({
      counts: { inactiveOrArchivedOwnerAssignmentRows: 1, validActiveOwnerAssignmentRows: 1_236 },
      ownerQueueCoverageComplete: true,
      status: "review_required",
    });
  });

  it("fails readiness for mismatches, legacy-only rows, or incomplete review queue coverage", () => {
    expect(
      summarizeStaffAssociationReconciliation(
        {
          ...reconciledRow,
          legacy_only_assignment_rows: 1,
          mismatched_staff_assignment_rows: 1,
          queued_case_review_rows: 0,
          queued_unassociated_task_rows: 0,
        },
        0,
      ),
    ).toMatchObject({
      ownerQueueCoverageComplete: false,
      queueCoverageComplete: false,
      status: "invalid",
      taskQueueCoverageComplete: false,
    });
  });

  it("runs repair and both privacy-safe queues in one repeatable transaction", async () => {
    const statements: string[] = [];
    const client: StaffAssociationPgClient = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async <T extends Record<string, unknown>>(sql: string) => {
        statements.push(sql.trim());
        if (sql.includes("AS count") && sql.includes("employee_profile_id IS DISTINCT")) {
          return { rowCount: 1, rows: [{ count: 0 } as unknown as T] };
        }
        if (sql.includes("UPDATE crm.case_assignment AS assignment")) {
          return { rowCount: 1_237, rows: [] };
        }
        if (sql.includes("FROM migration.staff_association_reconciliation AS report")) {
          return { rowCount: 1, rows: [reconciledRow as unknown as T] };
        }
        return { rowCount: 0, rows: [] };
      },
    };

    const result = await reconcileLegacyStaffAssociations(client);
    expect(result).toMatchObject({ backfilledRows: 1_237, status: "review_required" });
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContain("COMMIT");
    expect(statements.some((statement) => statement.includes("entity_type, task_id"))).toBe(true);
    expect(statements.some((statement) => statement.includes("identity.employee_profile"))).toBe(true);
  });

  it("requires a stable zero-write second reconciliation before release", () => {
    expect(assertStaffAssociationReleaseGate(summary(1_237), summary(0))).toMatchObject({
      firstBackfilledRows: 1_237,
      readiness: "review_required",
      reviewRequired: true,
      secondBackfilledRows: 0,
    });
    expect(() => assertStaffAssociationReleaseGate(summary(1_237), summary(1))).toThrowError(
      /still changed canonical associations/u,
    );
    expect(() =>
      assertStaffAssociationReleaseGate(
        summary(1_237),
        summarizeStaffAssociationReconciliation({ ...reconciledRow, queued_unassociated_task_rows: 0 }, 0),
      ),
    ).toThrowError(/reconciliation is invalid/u);
  });

  it("keeps provenance, active-owner semantics, task review and release wiring explicit", async () => {
    const [migrationSql, materializerSource, releaseGateSource, compose] = await Promise.all([
      readFile(path.resolve("db/migrations/0161_legacy_staff_associations.up.sql"), "utf8"),
      readFile(path.resolve("src/modules/migration/test-snapshot-materializer.ts"), "utf8"),
      readFile(path.resolve("src/staff-association-release-gate-once.ts"), "utf8"),
      readFile(path.resolve("compose.yaml"), "utf8"),
    ]);

    expect(migrationSql).toContain("case_assignment_actor_reference_required");
    expect(migrationSql).toContain("enforce_case_assignment_staff_association");
    expect(migrationSql).toContain(
      "assignment.employee_profile_id IS DISTINCT FROM actor.employee_profile_id",
    );
    expect(migrationSql).toContain("employee.employment_state = 'active'");
    expect(migrationSql).toContain("employee.archived_at IS NULL");
    expect(migrationSql).toContain("CASE_OWNER_EMPLOYEE_INACTIVE_OR_ARCHIVED");
    expect(migrationSql).toContain("TASK_CASE_AND_RESPONSIBLE_MISSING");
    expect(migrationSql).toContain("unassociated_legacy_task_rows");
    expect(migrationSql).toContain("legacyCrmTaskRowsPreserved");
    expect(materializerSource).toContain(
      "(id,case_id,employee_profile_id,legacy_actor_id,role,valid_from,provenance,created_at,updated_at)",
    );
    expect(materializerSource).toContain("actor.employee_profile_id,actor.id,'owner'");
    expect(materializerSource).toContain("crmTasksReviewRequired: crmTasks.reviewRequired");
    expect(releaseGateSource).toContain("runStaffAssociationReleaseGate");
    expect(compose).toContain("staff-association-release-gate:");
    expect(compose).toContain('command: ["node", "dist/staff-association-release-gate-once.js"]');
    expect(
      compose.match(/staff-association-release-gate:\n\s+condition: service_completed_successfully/gu),
    ).toHaveLength(3);
  });
});
