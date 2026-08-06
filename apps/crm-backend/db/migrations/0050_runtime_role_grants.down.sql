DO $runtime_grants$
DECLARE
    schema_name text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_migrator') THEN
        RETURN;
    END IF;

    FOREACH schema_name IN ARRAY ARRAY['identity', 'intake', 'crm', 'platform'] LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE ALL ON TABLES FROM kurs_crm_api, kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM kurs_crm_api, kurs_crm_worker',
            schema_name
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM kurs_crm_api, kurs_crm_worker',
            schema_name
        );
    END LOOP;
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA migration REVOKE ALL ON TABLES FROM kurs_crm_api';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA identity, intake, crm, platform, migration FROM kurs_crm_api';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, intake, crm, platform FROM kurs_crm_api, kurs_crm_worker';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform FROM kurs_crm_api, kurs_crm_worker';
    EXECUTE 'REVOKE USAGE ON SCHEMA identity, intake, crm, platform, migration FROM kurs_crm_api';
    EXECUTE 'REVOKE USAGE ON SCHEMA identity, intake, crm, platform FROM kurs_crm_worker';
END
$runtime_grants$;
