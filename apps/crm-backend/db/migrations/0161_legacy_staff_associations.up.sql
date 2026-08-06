-- Preserve the immutable Bitrix actor reference while making a proven employee
-- association available to CRM row-scope predicates. The legacy actor remains
-- provenance; employee_profile_id is the canonical authorization reference.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM crm.case_assignment AS assignment
        JOIN migration.legacy_actor AS actor ON actor.id = assignment.legacy_actor_id
        WHERE assignment.employee_profile_id IS NOT NULL
          AND assignment.employee_profile_id IS DISTINCT FROM actor.employee_profile_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'legacy case assignment employee association mismatch';
    END IF;
END;
$$;

DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT constraint_row.conname
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'crm.case_assignment'::regclass
          AND constraint_row.contype = 'c'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%employee_profile_id%'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%legacy_actor_id%'
    LOOP
        EXECUTE format('ALTER TABLE crm.case_assignment DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END;
$$;

ALTER TABLE crm.case_assignment
    ADD CONSTRAINT case_assignment_actor_reference_required
    CHECK (employee_profile_id IS NOT NULL OR legacy_actor_id IS NOT NULL);

CREATE OR REPLACE FUNCTION migration.enforce_case_assignment_staff_association()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    linked_employee_profile_id uuid;
BEGIN
    IF NEW.legacy_actor_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT actor.employee_profile_id
    INTO linked_employee_profile_id
    FROM migration.legacy_actor AS actor
    WHERE actor.id = NEW.legacy_actor_id;

    IF NEW.employee_profile_id IS NOT NULL
       AND NEW.employee_profile_id IS DISTINCT FROM linked_employee_profile_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'case assignment employee does not match its legacy actor';
    END IF;

    IF NEW.employee_profile_id IS NULL AND linked_employee_profile_id IS NOT NULL THEN
        NEW.employee_profile_id := linked_employee_profile_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_case_assignment_staff_association
BEFORE INSERT OR UPDATE OF employee_profile_id, legacy_actor_id
ON crm.case_assignment
FOR EACH ROW
EXECUTE FUNCTION migration.enforce_case_assignment_staff_association();

CREATE OR REPLACE FUNCTION migration.guard_legacy_actor_staff_relink()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.employee_profile_id IS DISTINCT FROM OLD.employee_profile_id
       AND EXISTS (
           SELECT 1
           FROM crm.case_assignment AS assignment
           WHERE assignment.legacy_actor_id = OLD.id
             AND assignment.employee_profile_id IS NOT NULL
             AND assignment.employee_profile_id IS DISTINCT FROM NEW.employee_profile_id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'legacy actor relink would invalidate canonical case assignments';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_legacy_actor_staff_relink
BEFORE UPDATE OF employee_profile_id
ON migration.legacy_actor
FOR EACH ROW
EXECUTE FUNCTION migration.guard_legacy_actor_staff_relink();

CREATE OR REPLACE FUNCTION migration.propagate_legacy_actor_staff_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.employee_profile_id IS NOT NULL
       AND NEW.employee_profile_id IS DISTINCT FROM OLD.employee_profile_id THEN
        UPDATE crm.case_assignment
        SET employee_profile_id = NEW.employee_profile_id
        WHERE legacy_actor_id = NEW.id
          AND employee_profile_id IS NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER propagate_legacy_actor_staff_link
AFTER UPDATE OF employee_profile_id
ON migration.legacy_actor
FOR EACH ROW
EXECUTE FUNCTION migration.propagate_legacy_actor_staff_link();

UPDATE crm.case_assignment AS assignment
SET employee_profile_id = actor.employee_profile_id
FROM migration.legacy_actor AS actor
WHERE actor.id = assignment.legacy_actor_id
  AND assignment.employee_profile_id IS NULL
  AND actor.employee_profile_id IS NOT NULL;

CREATE TABLE migration.staff_association_conflict (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('case', 'task')),
    case_id uuid REFERENCES crm."case"(id) ON DELETE CASCADE,
    task_id uuid REFERENCES crm.task(id) ON DELETE CASCADE,
    legacy_actor_id uuid REFERENCES migration.legacy_actor(id) ON DELETE RESTRICT,
    reason_code text NOT NULL CHECK (
        reason_code IN (
            'CASE_OWNER_ASSIGNMENT_MISSING',
            'CASE_OWNER_EMPLOYEE_INACTIVE_OR_ARCHIVED',
            'TASK_CASE_AND_RESPONSIBLE_MISSING'
        )
    ),
    state text NOT NULL CHECK (state IN ('open', 'resolved')),
    evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
    detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    resolved_at timestamptz,
    CHECK (
        (entity_type = 'case' AND case_id IS NOT NULL AND task_id IS NULL)
        OR (entity_type = 'task' AND task_id IS NOT NULL AND case_id IS NULL)
    ),
    CHECK (
        (entity_type = 'case' AND reason_code LIKE 'CASE_OWNER_%')
        OR (entity_type = 'task' AND reason_code = 'TASK_CASE_AND_RESPONSIBLE_MISSING')
    ),
    CHECK (
        (state = 'open' AND resolved_at IS NULL)
        OR (state = 'resolved' AND resolved_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX staff_association_conflict_case_uidx
    ON migration.staff_association_conflict (case_id)
    WHERE case_id IS NOT NULL;

CREATE UNIQUE INDEX staff_association_conflict_task_uidx
    ON migration.staff_association_conflict (task_id)
    WHERE task_id IS NOT NULL;

COMMENT ON TABLE migration.staff_association_conflict IS
    'Privacy-safe review queue for CRM cases without an active employee owner and legacy tasks without a case or responsible employee link.';

REVOKE ALL ON TABLE migration.staff_association_conflict FROM PUBLIC;

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
    entity_type,
    case_id,
    legacy_actor_id,
    reason_code,
    state,
    evidence_digest
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
ON CONFLICT (case_id) WHERE case_id IS NOT NULL DO NOTHING;

INSERT INTO migration.staff_association_conflict (
    entity_type,
    task_id,
    reason_code,
    state,
    evidence_digest
)
SELECT
    'task',
    task_row.id,
    'TASK_CASE_AND_RESPONSIBLE_MISSING',
    'open',
    encode(
        digest(
            task_row.id::text || chr(31) || 'TASK_CASE_AND_RESPONSIBLE_MISSING',
            'sha256'
        ),
        'hex'
    )
FROM crm.task AS task_row
WHERE task_row.archived_at IS NULL
  AND task_row.provenance->>'sourceSystem' = 'bitrix'
  AND task_row.provenance->>'sourceEntity' = 'b_tasks'
  AND task_row.case_id IS NULL
  AND task_row.responsible_employee_profile_id IS NULL
ON CONFLICT (task_id) WHERE task_id IS NOT NULL DO NOTHING;

-- Older completed ledgers counted every preserved task row as a successful
-- canonical association. Correct only the pinned test snapshot metadata while
-- retaining all task rows and immutable provenance.
UPDATE migration.test_snapshot_materialization AS materialization
SET counts = materialization.counts
    || jsonb_build_object(
        'legacyCrmTaskRowsPreserved', task_counts.preserved_rows,
        'canonicalCrmTasks', task_counts.associated_rows,
        'crmTasksReviewRequired', task_counts.review_required_rows
    )
FROM (
    SELECT
        count(*)::integer AS preserved_rows,
        count(*) FILTER (
            WHERE task_row.case_id IS NOT NULL
               OR task_row.responsible_employee_profile_id IS NOT NULL
        )::integer AS associated_rows,
        count(*) FILTER (
            WHERE task_row.case_id IS NULL
              AND task_row.responsible_employee_profile_id IS NULL
        )::integer AS review_required_rows
    FROM crm.task AS task_row
    WHERE task_row.provenance->>'sourceSystem' = 'bitrix'
      AND task_row.provenance->>'sourceEntity' = 'b_tasks'
      AND task_row.provenance->>'snapshotSha256'
          = '7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf'
) AS task_counts
WHERE materialization.snapshot_sha256
      = '7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf'
  AND materialization.state = 'completed';

CREATE OR REPLACE VIEW migration.staff_association_reconciliation AS
SELECT
    (SELECT count(*)::bigint FROM crm.case_assignment) AS assignment_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment
        WHERE legacy_actor_id IS NOT NULL
    ) AS legacy_assignment_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment AS assignment
        JOIN migration.legacy_actor AS actor ON actor.id = assignment.legacy_actor_id
        WHERE assignment.employee_profile_id = actor.employee_profile_id
          AND assignment.employee_profile_id IS NOT NULL
    ) AS matched_staff_assignment_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment AS assignment
        JOIN migration.legacy_actor AS actor ON actor.id = assignment.legacy_actor_id
        WHERE assignment.employee_profile_id IS NULL
          AND actor.employee_profile_id IS NOT NULL
    ) AS resolvable_legacy_only_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment AS assignment
        JOIN migration.legacy_actor AS actor ON actor.id = assignment.legacy_actor_id
        WHERE assignment.employee_profile_id IS NOT NULL
          AND assignment.employee_profile_id IS DISTINCT FROM actor.employee_profile_id
    ) AS mismatched_staff_assignment_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment AS assignment
        JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
         AND employee.employment_state = 'active'
         AND employee.archived_at IS NULL
        WHERE assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
    ) AS valid_active_owner_assignment_rows,
    (
        SELECT count(*)::bigint
        FROM crm.case_assignment AS assignment
        LEFT JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
        WHERE assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
          AND (
              employee.id IS NULL
              OR employee.employment_state <> 'active'
              OR employee.archived_at IS NOT NULL
          )
    ) AS inactive_or_archived_owner_assignment_rows,
    (
        SELECT count(DISTINCT assignment.employee_profile_id)::bigint
        FROM crm.case_assignment AS assignment
        JOIN identity.employee_profile AS employee
          ON employee.id = assignment.employee_profile_id
         AND employee.employment_state = 'active'
         AND employee.archived_at IS NULL
        WHERE assignment.role = 'owner'
          AND assignment.valid_from <= statement_timestamp()
          AND (assignment.valid_to IS NULL OR assignment.valid_to > statement_timestamp())
          AND assignment.archived_at IS NULL
    ) AS active_linked_specialists,
    (
        SELECT count(*)::bigint
        FROM crm."case" AS case_row
        WHERE case_row.archived_at IS NULL
          AND NOT EXISTS (
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
    ) AS ownerless_active_cases,
    (
        SELECT count(*)::bigint
        FROM crm."case" AS case_row
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
    ) AS case_association_review_rows,
    (
        SELECT count(*)::bigint
        FROM migration.staff_association_conflict
        WHERE entity_type = 'case' AND state = 'open'
    ) AS queued_case_review_rows,
    (
        SELECT count(*)::bigint
        FROM crm.task AS task_row
        WHERE task_row.archived_at IS NULL
          AND task_row.provenance->>'sourceSystem' = 'bitrix'
          AND task_row.provenance->>'sourceEntity' = 'b_tasks'
    ) AS legacy_task_rows,
    (
        SELECT count(*)::bigint
        FROM crm.task AS task_row
        WHERE task_row.archived_at IS NULL
          AND task_row.provenance->>'sourceSystem' = 'bitrix'
          AND task_row.provenance->>'sourceEntity' = 'b_tasks'
          AND (
              task_row.case_id IS NOT NULL
              OR task_row.responsible_employee_profile_id IS NOT NULL
          )
    ) AS associated_legacy_task_rows,
    (
        SELECT count(*)::bigint
        FROM crm.task AS task_row
        WHERE task_row.archived_at IS NULL
          AND task_row.provenance->>'sourceSystem' = 'bitrix'
          AND task_row.provenance->>'sourceEntity' = 'b_tasks'
          AND task_row.case_id IS NULL
          AND task_row.responsible_employee_profile_id IS NULL
    ) AS unassociated_legacy_task_rows,
    (
        SELECT count(*)::bigint
        FROM migration.staff_association_conflict
        WHERE entity_type = 'task' AND state = 'open'
    ) AS queued_unassociated_task_rows;

REVOKE ALL ON migration.staff_association_reconciliation FROM PUBLIC;
