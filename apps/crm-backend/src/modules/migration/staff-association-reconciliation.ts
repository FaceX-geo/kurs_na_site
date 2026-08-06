import { Client } from "pg";
import { MigrationError } from "./errors.js";

const ADVISORY_LOCK_KEY = 4_936_470_161;

export interface StaffAssociationReconciliationCounts {
  readonly activeLinkedSpecialists: number;
  readonly associatedLegacyTaskRows: number;
  readonly assignmentRows: number;
  readonly caseAssociationReviewRows: number;
  readonly inactiveOrArchivedOwnerAssignmentRows: number;
  readonly legacyAssignmentRows: number;
  readonly legacyOnlyAssignmentRows: number;
  readonly legacyTaskRows: number;
  readonly matchedStaffAssignmentRows: number;
  readonly mismatchedStaffAssignmentRows: number;
  readonly ownerlessActiveCases: number;
  readonly queuedCaseReviewRows: number;
  readonly queuedUnassociatedTaskRows: number;
  readonly resolvableLegacyOnlyRows: number;
  readonly unassociatedLegacyTaskRows: number;
  readonly validActiveOwnerAssignmentRows: number;
}

export type StaffAssociationReconciliationStatus = "invalid" | "ok" | "review_required";

export interface StaffAssociationReconciliationSummary {
  readonly backfilledRows: number;
  readonly counts: StaffAssociationReconciliationCounts;
  readonly ownerQueueCoverageComplete: boolean;
  readonly ownerlessCasesRequireReview: boolean;
  readonly queueCoverageComplete: boolean;
  readonly status: StaffAssociationReconciliationStatus;
  readonly taskQueueCoverageComplete: boolean;
  readonly unassociatedTasksRequireReview: boolean;
}

export interface StaffAssociationPgClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number | null; readonly rows: readonly T[] }>;
}

interface ReconciliationRow extends Record<string, unknown> {
  active_linked_specialists: string | number;
  associated_legacy_task_rows: string | number;
  assignment_rows: string | number;
  case_association_review_rows: string | number;
  inactive_or_archived_owner_assignment_rows: string | number;
  legacy_assignment_rows: string | number;
  legacy_only_assignment_rows: string | number;
  legacy_task_rows: string | number;
  matched_staff_assignment_rows: string | number;
  mismatched_staff_assignment_rows: string | number;
  ownerless_active_cases: string | number;
  queued_case_review_rows: string | number;
  queued_unassociated_task_rows: string | number;
  resolvable_legacy_only_rows: string | number;
  unassociated_legacy_task_rows: string | number;
  valid_active_owner_assignment_rows: string | number;
}

const MISMATCH_COUNT_SQL = `
SELECT count(*)::bigint AS count
FROM crm.case_assignment AS assignment
JOIN migration.legacy_actor AS actor ON actor.id = assignment.legacy_actor_id
WHERE assignment.employee_profile_id IS NOT NULL
  AND assignment.employee_profile_id IS DISTINCT FROM actor.employee_profile_id`;

const BACKFILL_SQL = `
UPDATE crm.case_assignment AS assignment
SET employee_profile_id = actor.employee_profile_id
FROM migration.legacy_actor AS actor
WHERE actor.id = assignment.legacy_actor_id
  AND assignment.employee_profile_id IS NULL
  AND actor.employee_profile_id IS NOT NULL`;

const RESOLVE_QUEUE_SQL = `
UPDATE migration.staff_association_conflict AS conflict
SET state = 'resolved',
    resolved_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE conflict.state = 'open'
  AND (
    (
      conflict.entity_type = 'case'
      AND (
        NOT EXISTS (
          SELECT 1 FROM crm."case" AS case_row
          WHERE case_row.id = conflict.case_id
            AND case_row.archived_at IS NULL
        )
        OR (
          EXISTS (
            SELECT 1
            FROM crm.case_assignment AS assignment
            JOIN identity.employee_profile AS employee
              ON employee.id = assignment.employee_profile_id
             AND employee.employment_state = 'active'
             AND employee.archived_at IS NULL
            WHERE assignment.case_id = conflict.case_id
              AND assignment.role = 'owner'
              AND assignment.valid_from <= statement_timestamp()
              AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
              AND assignment.archived_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM crm.case_assignment AS assignment
            LEFT JOIN identity.employee_profile AS employee
              ON employee.id = assignment.employee_profile_id
            WHERE assignment.case_id = conflict.case_id
              AND assignment.role = 'owner'
              AND assignment.valid_from <= statement_timestamp()
              AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
              AND assignment.archived_at IS NULL
              AND (
                employee.id IS NULL
                OR employee.employment_state <> 'active'
                OR employee.archived_at IS NOT NULL
              )
          )
        )
      )
    )
    OR (
      conflict.entity_type = 'task'
      AND (
        NOT EXISTS (
          SELECT 1 FROM crm.task AS task_row
          WHERE task_row.id = conflict.task_id
            AND task_row.archived_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM crm.task AS task_row
          WHERE task_row.id = conflict.task_id
            AND task_row.archived_at IS NULL
            AND (
              task_row.case_id IS NOT NULL
              OR task_row.responsible_employee_profile_id IS NOT NULL
            )
        )
      )
    )
  )`;

const QUEUE_CASE_REVIEW_SQL = `
WITH candidate AS (
  SELECT
    case_row.id AS case_id,
    previous_owner.legacy_actor_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM crm.case_assignment AS assignment
        LEFT JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
        WHERE assignment.case_id = case_row.id
          AND assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
          AND (
            employee.id IS NULL
            OR employee.employment_state <> 'active'
            OR employee.archived_at IS NOT NULL
          )
      ) THEN 'CASE_OWNER_EMPLOYEE_INACTIVE_OR_ARCHIVED'
      ELSE 'CASE_OWNER_ASSIGNMENT_MISSING'
    END AS reason_code
  FROM crm."case" AS case_row
  LEFT JOIN LATERAL (
    SELECT assignment.legacy_actor_id
    FROM crm.case_assignment AS assignment
    WHERE assignment.case_id = case_row.id
      AND assignment.legacy_actor_id IS NOT NULL
    ORDER BY assignment.valid_from DESC, assignment.id DESC
    LIMIT 1
  ) AS previous_owner ON true
  WHERE case_row.archived_at IS NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM crm.case_assignment AS assignment
        JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
         AND employee.employment_state = 'active'
         AND employee.archived_at IS NULL
        WHERE assignment.case_id = case_row.id
          AND assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM crm.case_assignment AS assignment
        LEFT JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
        WHERE assignment.case_id = case_row.id
          AND assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
          AND (
            employee.id IS NULL
            OR employee.employment_state <> 'active'
            OR employee.archived_at IS NOT NULL
          )
      )
    )
)
INSERT INTO migration.staff_association_conflict (
  entity_type, case_id, legacy_actor_id, reason_code, state, evidence_digest
)
SELECT
  'case',
  candidate.case_id,
  candidate.legacy_actor_id,
  candidate.reason_code,
  'open',
  encode(
    digest(
      candidate.case_id::text || chr(31) || candidate.reason_code || chr(31)
      || coalesce(candidate.legacy_actor_id::text, 'none'),
      'sha256'
    ),
    'hex'
  )
FROM candidate
ON CONFLICT (case_id) WHERE case_id IS NOT NULL DO UPDATE
SET legacy_actor_id = EXCLUDED.legacy_actor_id,
    reason_code = EXCLUDED.reason_code,
    state = 'open',
    evidence_digest = EXCLUDED.evidence_digest,
    resolved_at = NULL,
    updated_at = clock_timestamp()
WHERE migration.staff_association_conflict.state <> 'open'
   OR migration.staff_association_conflict.legacy_actor_id IS DISTINCT FROM EXCLUDED.legacy_actor_id
   OR migration.staff_association_conflict.reason_code <> EXCLUDED.reason_code
   OR migration.staff_association_conflict.evidence_digest <> EXCLUDED.evidence_digest`;

const QUEUE_UNASSOCIATED_TASK_SQL = `
INSERT INTO migration.staff_association_conflict (
  entity_type, task_id, reason_code, state, evidence_digest
)
SELECT
  'task',
  task_row.id,
  'TASK_CASE_AND_RESPONSIBLE_MISSING',
  'open',
  encode(
    digest(task_row.id::text || chr(31) || 'TASK_CASE_AND_RESPONSIBLE_MISSING', 'sha256'),
    'hex'
  )
FROM crm.task AS task_row
WHERE task_row.archived_at IS NULL
  AND task_row.provenance->>'sourceSystem' = 'bitrix'
  AND task_row.provenance->>'sourceEntity' = 'b_tasks'
  AND task_row.case_id IS NULL
  AND task_row.responsible_employee_profile_id IS NULL
ON CONFLICT (task_id) WHERE task_id IS NOT NULL DO UPDATE
SET state = 'open',
    evidence_digest = EXCLUDED.evidence_digest,
    resolved_at = NULL,
    updated_at = clock_timestamp()
WHERE migration.staff_association_conflict.state <> 'open'
   OR migration.staff_association_conflict.evidence_digest <> EXCLUDED.evidence_digest`;

const REPORT_SQL = `
SELECT
  report.assignment_rows,
  report.legacy_assignment_rows,
  report.matched_staff_assignment_rows,
  report.resolvable_legacy_only_rows,
  report.mismatched_staff_assignment_rows,
  report.valid_active_owner_assignment_rows,
  report.inactive_or_archived_owner_assignment_rows,
  report.active_linked_specialists,
  report.ownerless_active_cases,
  report.case_association_review_rows,
  report.queued_case_review_rows,
  report.legacy_task_rows,
  report.associated_legacy_task_rows,
  report.unassociated_legacy_task_rows,
  report.queued_unassociated_task_rows,
  (
    SELECT count(*)::bigint
    FROM crm.case_assignment
    WHERE legacy_actor_id IS NOT NULL
      AND employee_profile_id IS NULL
  ) AS legacy_only_assignment_rows
FROM migration.staff_association_reconciliation AS report`;

function count(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new MigrationError(
      "STAFF_ASSOCIATION_RECONCILIATION_INVALID",
      "Staff association reconciliation returned an invalid aggregate",
    );
  }
  return result;
}

export function summarizeStaffAssociationReconciliation(
  row: ReconciliationRow,
  backfilledRows: number,
): StaffAssociationReconciliationSummary {
  const counts: StaffAssociationReconciliationCounts = {
    activeLinkedSpecialists: count(row.active_linked_specialists),
    associatedLegacyTaskRows: count(row.associated_legacy_task_rows),
    assignmentRows: count(row.assignment_rows),
    caseAssociationReviewRows: count(row.case_association_review_rows),
    inactiveOrArchivedOwnerAssignmentRows: count(row.inactive_or_archived_owner_assignment_rows),
    legacyAssignmentRows: count(row.legacy_assignment_rows),
    legacyOnlyAssignmentRows: count(row.legacy_only_assignment_rows),
    legacyTaskRows: count(row.legacy_task_rows),
    matchedStaffAssignmentRows: count(row.matched_staff_assignment_rows),
    mismatchedStaffAssignmentRows: count(row.mismatched_staff_assignment_rows),
    ownerlessActiveCases: count(row.ownerless_active_cases),
    queuedCaseReviewRows: count(row.queued_case_review_rows),
    queuedUnassociatedTaskRows: count(row.queued_unassociated_task_rows),
    resolvableLegacyOnlyRows: count(row.resolvable_legacy_only_rows),
    unassociatedLegacyTaskRows: count(row.unassociated_legacy_task_rows),
    validActiveOwnerAssignmentRows: count(row.valid_active_owner_assignment_rows),
  };
  const ownerQueueCoverageComplete = counts.caseAssociationReviewRows === counts.queuedCaseReviewRows;
  const taskQueueCoverageComplete = counts.unassociatedLegacyTaskRows === counts.queuedUnassociatedTaskRows;
  const queueCoverageComplete = ownerQueueCoverageComplete && taskQueueCoverageComplete;
  const invalid =
    counts.mismatchedStaffAssignmentRows > 0 ||
    counts.legacyOnlyAssignmentRows > 0 ||
    counts.resolvableLegacyOnlyRows > 0 ||
    !queueCoverageComplete;
  const reviewRequired = counts.caseAssociationReviewRows > 0 || counts.unassociatedLegacyTaskRows > 0;
  return {
    backfilledRows,
    counts,
    ownerQueueCoverageComplete,
    ownerlessCasesRequireReview: counts.caseAssociationReviewRows > 0,
    queueCoverageComplete,
    status: invalid ? "invalid" : reviewRequired ? "review_required" : "ok",
    taskQueueCoverageComplete,
    unassociatedTasksRequireReview: counts.unassociatedLegacyTaskRows > 0,
  };
}

export async function reconcileLegacyStaffAssociations(
  client: StaffAssociationPgClient,
): Promise<StaffAssociationReconciliationSummary> {
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);
    const mismatch = await client.query<{ count: string | number }>(MISMATCH_COUNT_SQL);
    if (count(mismatch.rows[0]?.count ?? 0) > 0) {
      throw new MigrationError(
        "STAFF_ASSOCIATION_MISMATCH",
        "Legacy actor and employee profile associations disagree",
      );
    }
    const backfill = await client.query(BACKFILL_SQL);
    await client.query(RESOLVE_QUEUE_SQL);
    await client.query(QUEUE_CASE_REVIEW_SQL);
    await client.query(QUEUE_UNASSOCIATED_TASK_SQL);
    const report = await client.query<ReconciliationRow>(REPORT_SQL);
    const row = report.rows[0];
    if (!row) {
      throw new MigrationError(
        "STAFF_ASSOCIATION_RECONCILIATION_INVALID",
        "Staff association reconciliation did not return a report",
      );
    }
    const summary = summarizeStaffAssociationReconciliation(row, backfill.rowCount ?? 0);
    await client.query("COMMIT");
    transactionOpen = false;
    return summary;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function createStaffAssociationClient(databaseUrl: string): StaffAssociationPgClient {
  return new Client({
    connectionString: databaseUrl,
    application_name: "kurs-crm-staff-association-reconciliation",
  });
}
