DROP VIEW IF EXISTS migration.staff_association_reconciliation;

UPDATE migration.test_snapshot_materialization AS materialization
SET counts = (materialization.counts - 'legacyCrmTaskRowsPreserved' - 'crmTasksReviewRequired')
    || jsonb_build_object(
        'canonicalCrmTasks',
        coalesce(
            (materialization.counts->>'legacyCrmTaskRowsPreserved')::integer,
            (materialization.counts->>'canonicalCrmTasks')::integer
        )
    )
WHERE materialization.snapshot_sha256
      = '7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf'
  AND materialization.state = 'completed';

DROP TABLE IF EXISTS migration.staff_association_conflict;

DROP TRIGGER IF EXISTS propagate_legacy_actor_staff_link ON migration.legacy_actor;
DROP FUNCTION IF EXISTS migration.propagate_legacy_actor_staff_link();
DROP TRIGGER IF EXISTS guard_legacy_actor_staff_relink ON migration.legacy_actor;
DROP FUNCTION IF EXISTS migration.guard_legacy_actor_staff_relink();
DROP TRIGGER IF EXISTS enforce_case_assignment_staff_association ON crm.case_assignment;
DROP FUNCTION IF EXISTS migration.enforce_case_assignment_staff_association();

UPDATE crm.case_assignment
SET employee_profile_id = NULL
WHERE legacy_actor_id IS NOT NULL;

ALTER TABLE crm.case_assignment
    DROP CONSTRAINT IF EXISTS case_assignment_actor_reference_required;

ALTER TABLE crm.case_assignment
    ADD CONSTRAINT case_assignment_actor_reference_exclusive
    CHECK (
        (employee_profile_id IS NOT NULL)::integer
        + (legacy_actor_id IS NOT NULL)::integer
        = 1
    );
