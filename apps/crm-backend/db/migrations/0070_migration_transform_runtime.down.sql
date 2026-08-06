DO $runtime_grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') THEN
        EXECUTE 'REVOKE ALL ON migration.ledger_target, migration.ledger_attempt FROM kurs_crm_api';
    END IF;
END
$runtime_grants$;

DROP TRIGGER IF EXISTS migration_ledger_target_append_only ON migration.ledger_target;
DROP TRIGGER IF EXISTS migration_ledger_attempt_append_only ON migration.ledger_attempt;
DROP TABLE IF EXISTS migration.ledger_target;
DROP TABLE IF EXISTS migration.ledger_attempt;
