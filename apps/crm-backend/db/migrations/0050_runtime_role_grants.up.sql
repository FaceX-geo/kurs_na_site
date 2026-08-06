-- Runtime roles are provisioned by deploy/postgres-init/10-runtime-roles.sh.
-- The conditional keeps migrations portable for isolated developer/test databases.
DO $runtime_grants$
DECLARE
    schema_name text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_migrator') THEN
        RAISE NOTICE 'CRM runtime roles are absent; skipping deployment grants';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA identity, intake, crm, platform, migration TO kurs_crm_api';
    EXECUTE 'GRANT USAGE ON SCHEMA identity, intake, crm, platform TO kurs_crm_worker';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, intake, crm, platform TO kurs_crm_api';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA migration TO kurs_crm_api';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, intake, crm, platform TO kurs_crm_worker';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, intake, crm, platform TO kurs_crm_api, kurs_crm_worker';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform TO kurs_crm_api, kurs_crm_worker';

    EXECUTE 'REVOKE UPDATE, DELETE ON platform.audit_event FROM kurs_crm_api, kurs_crm_worker';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON platform.schema_migration FROM kurs_crm_api, kurs_crm_worker';

    FOREACH schema_name IN ARRAY ARRAY['identity', 'intake', 'crm', 'platform'] LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kurs_crm_api, kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO kurs_crm_api, kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO kurs_crm_api, kurs_crm_worker',
            schema_name
        );
    END LOOP;

    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA migration GRANT SELECT ON TABLES TO kurs_crm_api';
END
$runtime_grants$;
