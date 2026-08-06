DROP TRIGGER IF EXISTS migration_conflict_runtime_metadata_only ON migration.conflict;
DROP TRIGGER IF EXISTS migration_ledger_runtime_immutable ON migration.ledger;
DROP TRIGGER IF EXISTS migration_ledger_runtime_metadata_only ON migration.ledger;
DROP FUNCTION IF EXISTS migration.reject_runtime_ledger_mutation();
DROP FUNCTION IF EXISTS migration.enforce_runtime_metadata_only();

ALTER TABLE migration.conflict
    DROP CONSTRAINT IF EXISTS migration_conflict_ledger_key_fk,
    DROP CONSTRAINT IF EXISTS migration_conflict_ledger_key_unique,
    DROP COLUMN IF EXISTS source_key_digest,
    DROP COLUMN IF EXISTS ledger_key;

ALTER TABLE migration.ledger
    DROP CONSTRAINT IF EXISTS migration_ledger_ledger_key_unique,
    DROP COLUMN IF EXISTS recorded_at,
    DROP COLUMN IF EXISTS attempt,
    DROP COLUMN IF EXISTS source_key_digest,
    DROP COLUMN IF EXISTS ledger_key;

ALTER TABLE migration.run
    DROP COLUMN IF EXISTS failure_code,
    DROP COLUMN IF EXISTS outcome_counts,
    DROP COLUMN IF EXISTS already_applied_rows,
    DROP COLUMN IF EXISTS processed_rows,
    DROP COLUMN IF EXISTS expected_rows,
    DROP COLUMN IF EXISTS adapter_name,
    DROP COLUMN IF EXISTS mode;
