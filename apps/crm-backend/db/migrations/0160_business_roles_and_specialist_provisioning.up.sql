-- Product-facing business roles remain a narrow projection over the internal
-- authorization catalog. Technical roles keep their existing meaning and are
-- never exposed as an additional CRM product role.
INSERT INTO identity.permission (code, domain, description)
VALUES
    ('identity.employees.read', 'identity', 'Чтение активных сотрудников, доступных для создания учётной записи'),
    ('identity.specialists.provision', 'identity', 'Атомарное создание специалиста для существующего сотрудника')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('platform_superadmin', 'identity.employees.read'),
    ('platform_superadmin', 'identity.specialists.provision')
ON CONFLICT (role_code, permission_code) DO NOTHING;

UPDATE identity.role
SET title = 'Суперадминистратор',
    description = 'Продуктовая роль SUPER_ADMIN: управление пользователями и сотрудниками без неявного CRM-доступа'
WHERE code = 'platform_superadmin';

UPDATE identity.role
SET title = 'Специалист',
    description = 'Продуктовая роль SPECIALIST: работа только с назначенными делами и задачами CRM'
WHERE code = 'crm_project_manager';

-- The product role invariant is temporal: scheduled and finite assignments
-- must not overlap, even when neither row is open-ended. btree_gist makes the
-- interval constraint concurrency-safe instead of relying on a trigger-only
-- check that two concurrent writers could both pass.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM identity.user_role_assignment AS left_assignment
        JOIN identity.user_role_assignment AS right_assignment
          ON right_assignment.user_account_id = left_assignment.user_account_id
         AND right_assignment.id > left_assignment.id
        WHERE left_assignment.role_code IN ('platform_superadmin', 'crm_project_manager')
          AND right_assignment.role_code IN ('platform_superadmin', 'crm_project_manager')
          AND left_assignment.archived_at IS NULL
          AND right_assignment.archived_at IS NULL
          AND tstzrange(left_assignment.valid_from, left_assignment.valid_to, '[)')
              && tstzrange(right_assignment.valid_from, right_assignment.valid_to, '[)')
    ) THEN
        RAISE EXCEPTION 'overlapping identity business role intervals must be resolved before migration 0160'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM identity.user_role_assignment AS assignment
        INNER JOIN identity.user_account AS account
            ON account.id = assignment.user_account_id
        LEFT JOIN identity.employee_profile AS employee
            ON employee.id = assignment.scope_id
        WHERE assignment.role_code IN ('platform_superadmin', 'crm_project_manager')
          AND (assignment.valid_to IS NULL OR assignment.valid_to > clock_timestamp())
          AND assignment.archived_at IS NULL
          AND (
              (
                  assignment.role_code = 'platform_superadmin'
                  AND (assignment.scope_type <> 'all' OR assignment.scope_id IS NOT NULL)
              )
              OR (
                  assignment.role_code = 'crm_project_manager'
                  AND (
                      assignment.scope_type <> 'assigned'
                      OR assignment.scope_id IS NULL
                      OR employee.id IS NULL
                      OR employee.person_id <> account.person_id
                      OR employee.employment_state <> 'active'
                      OR employee.archived_at IS NOT NULL
                  )
              )
          )
    ) THEN
        RAISE EXCEPTION 'invalid active identity business role scope must be resolved before migration 0160'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION identity.enforce_active_business_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    employee_matches_account boolean;
BEGIN
    IF NEW.role_code NOT IN ('platform_superadmin', 'crm_project_manager')
       OR (NEW.valid_to IS NOT NULL AND NEW.valid_to <= clock_timestamp())
       OR NEW.archived_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.role_code = 'platform_superadmin' THEN
        IF NEW.scope_type <> 'all' OR NEW.scope_id IS NOT NULL THEN
            RAISE EXCEPTION 'platform_superadmin requires all scope without scope_id'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.scope_type <> 'assigned' OR NEW.scope_id IS NULL THEN
        RAISE EXCEPTION 'crm_project_manager requires assigned employee scope'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM identity.employee_profile AS employee
        INNER JOIN identity.user_account AS account
            ON account.person_id = employee.person_id
        WHERE employee.id = NEW.scope_id
          AND account.id = NEW.user_account_id
          AND employee.employment_state = 'active'
          AND employee.archived_at IS NULL
    )
    INTO employee_matches_account;

    IF NOT employee_matches_account THEN
        RAISE EXCEPTION 'crm_project_manager scope must reference its own active employee profile'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_active_business_role_assignment
    ON identity.user_role_assignment;
CREATE TRIGGER enforce_active_business_role_assignment
BEFORE INSERT OR UPDATE ON identity.user_role_assignment
FOR EACH ROW
EXECUTE FUNCTION identity.enforce_active_business_role_assignment();

ALTER TABLE identity.user_role_assignment
    ADD CONSTRAINT identity_business_role_interval_excl
    EXCLUDE USING gist (
        user_account_id WITH =,
        tstzrange(valid_from, valid_to, '[)') WITH &&
    )
    WHERE (
        role_code IN ('platform_superadmin', 'crm_project_manager')
        AND archived_at IS NULL
    );

CREATE INDEX IF NOT EXISTS employee_provisioning_keyset_idx
    ON identity.employee_profile (created_at DESC, id DESC)
    WHERE employment_state = 'active' AND archived_at IS NULL;
