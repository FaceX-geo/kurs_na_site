-- Rollback restores the broad worker bootstrap state established by 0050 while preserving the
-- credential-delivery isolation introduced by 0080. It is destructive only to the tightened ACL.
DO $routing_worker_least_privilege$
DECLARE
    schema_name text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_migrator') THEN
        RETURN;
    END IF;

    FOREACH schema_name IN ARRAY ARRAY['identity', 'intake', 'crm', 'platform'] LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
            schema_name
        );
    END LOOP;

    EXECUTE 'GRANT USAGE ON SCHEMA identity, intake, crm, platform TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, intake, crm, platform TO kurs_crm_worker';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, intake, crm, platform TO kurs_crm_worker';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform TO kurs_crm_worker';

    -- Restore the pre-0130 PUBLIC ACL only for functions that had the PostgreSQL default grant.
    -- The two SECURITY DEFINER identity predicates remain explicitly non-PUBLIC as defined by 0110.
    EXECUTE 'GRANT EXECUTE ON FUNCTION platform.touch_versioned_row() TO PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION platform.reject_mutation() TO PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION intake.require_binding_for_new_upload() TO PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION crm.enforce_candidate_merge_invariants() TO PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION crm.enforce_employee_profile_candidate_merge_boundary() TO PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION crm.enforce_one_open_case_per_profile_route() TO PUBLIC';

    EXECUTE 'REVOKE UPDATE, DELETE ON platform.audit_event FROM kurs_crm_worker';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON platform.schema_migration FROM kurs_crm_worker';
    IF to_regclass('identity.credential_delivery') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON identity.credential_delivery FROM kurs_crm_worker';
    END IF;
END
$routing_worker_least_privilege$;
