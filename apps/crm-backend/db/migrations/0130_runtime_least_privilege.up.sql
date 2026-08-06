-- 0050 intentionally bootstrapped broad grants while the runtime contract was still forming.
-- The routing worker now has a stable, narrow data-flow, so remove every inherited broad grant
-- (including function EXECUTE inherited through PUBLIC) before granting the exact verbs it uses.
DO $routing_worker_least_privilege$
DECLARE
    schema_name text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_migrator') THEN
        RAISE NOTICE 'CRM routing-worker roles are absent; skipping least-privilege deployment grants';
        RETURN;
    END IF;

    FOREACH schema_name IN ARRAY ARRAY['identity', 'intake', 'crm', 'platform'] LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE USAGE, SELECT ON SEQUENCES FROM kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
            schema_name
        );
    END LOOP;

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform FROM PUBLIC';
    EXECUTE 'REVOKE USAGE ON SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';

    EXECUTE 'GRANT USAGE ON SCHEMA identity, intake, crm, platform TO kurs_crm_worker';

    -- Intake source records are immutable to the worker except for the submission routing state.
    EXECUTE 'GRANT SELECT ON intake.upload TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, UPDATE ON intake.submission TO kurs_crm_worker';

    -- The worker may create a candidate identity, but cannot inspect authentication or role data.
    EXECUTE 'GRANT SELECT, INSERT ON identity.person TO kurs_crm_worker';

    -- Canonical CRM rows created by one routing transaction.
    EXECUTE 'GRANT SELECT, INSERT ON crm.profile TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT ON crm.program_participation TO kurs_crm_worker';
    EXECUTE 'GRANT INSERT ON crm.candidate_source TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT ON crm."case" TO kurs_crm_worker';
    EXECUTE 'GRANT INSERT ON crm.case_person TO kurs_crm_worker';
    EXECUTE 'GRANT INSERT ON crm.candidate_document TO kurs_crm_worker';
    EXECUTE 'GRANT INSERT ON crm.relocation_profile TO kurs_crm_worker';

    -- appendAuditEvent needs the previous hash plus an append; delivery uses outbox/inbox.
    EXECUTE 'GRANT SELECT, INSERT ON platform.audit_event TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON platform.outbox_event TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT ON platform.inbox_event TO kurs_crm_worker';

    IF to_regprocedure('identity.person_has_user_account(uuid)') IS NULL
       OR to_regprocedure('identity.person_has_employee_profile(uuid)') IS NULL THEN
        RAISE EXCEPTION 'routing identity guard functions are required before migration 0130'
            USING ERRCODE = 'undefined_function';
    END IF;

    EXECUTE 'GRANT EXECUTE ON FUNCTION identity.person_has_user_account(uuid) TO kurs_crm_worker';
    EXECUTE 'GRANT EXECUTE ON FUNCTION identity.person_has_employee_profile(uuid) TO kurs_crm_worker';
END
$routing_worker_least_privilege$;
