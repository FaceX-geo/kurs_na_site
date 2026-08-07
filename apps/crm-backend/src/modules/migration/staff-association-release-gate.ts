import { MigrationError } from "./errors.js";
import {
  reconcileLegacyStaffAssociations,
  type StaffAssociationPgClient,
  type StaffAssociationReconciliationCounts,
  type StaffAssociationReconciliationStatus,
  type StaffAssociationReconciliationSummary,
} from "./staff-association-reconciliation.js";

export interface StaffAssociationReleaseGateSummary {
  readonly counts: StaffAssociationReconciliationCounts;
  readonly firstBackfilledRows: number;
  readonly readiness: Exclude<StaffAssociationReconciliationStatus, "invalid">;
  readonly reviewRequired: boolean;
  readonly secondBackfilledRows: 0;
}

function sameCounts(
  left: StaffAssociationReconciliationCounts,
  right: StaffAssociationReconciliationCounts,
): boolean {
  return Object.entries(left).every(
    ([key, value]) => right[key as keyof StaffAssociationReconciliationCounts] === value,
  );
}

export function assertStaffAssociationReleaseGate(
  first: StaffAssociationReconciliationSummary,
  second: StaffAssociationReconciliationSummary,
): StaffAssociationReleaseGateSummary {
  if (first.status === "invalid" || second.status === "invalid") {
    throw new MigrationError(
      "STAFF_ASSOCIATION_RELEASE_GATE_INVALID",
      "Legacy staff association reconciliation is invalid",
    );
  }
  if (second.backfilledRows !== 0) {
    throw new MigrationError(
      "STAFF_ASSOCIATION_RELEASE_GATE_NOT_IDEMPOTENT",
      "Repeated legacy staff reconciliation still changed canonical associations",
    );
  }
  if (!sameCounts(first.counts, second.counts)) {
    throw new MigrationError(
      "STAFF_ASSOCIATION_RELEASE_GATE_DRIFT",
      "Legacy staff reconciliation aggregate changed between repeated runs",
    );
  }
  return {
    counts: second.counts,
    firstBackfilledRows: first.backfilledRows,
    readiness: second.status,
    reviewRequired: second.status === "review_required",
    secondBackfilledRows: 0,
  };
}

export async function runStaffAssociationReleaseGate(
  createClient: () => StaffAssociationPgClient,
): Promise<StaffAssociationReleaseGateSummary> {
  const first = await reconcileLegacyStaffAssociations(createClient());
  if (first.status === "invalid") {
    throw new MigrationError(
      "STAFF_ASSOCIATION_RELEASE_GATE_INVALID",
      "Legacy staff association reconciliation is invalid",
    );
  }
  const second = await reconcileLegacyStaffAssociations(createClient());
  return assertStaffAssociationReleaseGate(first, second);
}
