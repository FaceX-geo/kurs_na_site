ALTER TABLE migration.run
    ADD COLUMN mode text CHECK (mode IN ('dry-run', 'import')),
    ADD COLUMN adapter_name text CHECK (adapter_name IS NULL OR length(adapter_name) BETWEEN 1 AND 128),
    ADD COLUMN expected_rows bigint NOT NULL DEFAULT 0 CHECK (expected_rows >= 0),
    ADD COLUMN processed_rows bigint NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
    ADD COLUMN already_applied_rows bigint NOT NULL DEFAULT 0 CHECK (already_applied_rows >= 0),
    ADD COLUMN outcome_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(outcome_counts) = 'object'),
    ADD COLUMN failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,128}$');

ALTER TABLE migration.ledger
    ADD COLUMN ledger_key text CHECK (ledger_key IS NULL OR ledger_key ~ '^[a-f0-9]{64}$'),
    ADD COLUMN source_key_digest text CHECK (source_key_digest IS NULL OR source_key_digest ~ '^[a-f0-9]{64}$'),
    ADD COLUMN attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
    ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ADD CONSTRAINT migration_ledger_ledger_key_unique UNIQUE (ledger_key);

ALTER TABLE migration.conflict
    ADD COLUMN ledger_key text CHECK (ledger_key IS NULL OR ledger_key ~ '^[a-f0-9]{64}$'),
    ADD COLUMN source_key_digest text CHECK (source_key_digest IS NULL OR source_key_digest ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT migration_conflict_ledger_key_unique UNIQUE (ledger_key),
    ADD CONSTRAINT migration_conflict_ledger_key_fk
        FOREIGN KEY (ledger_key) REFERENCES migration.ledger(ledger_key) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION migration.enforce_runtime_metadata_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ledger_key IS NOT NULL AND (NEW.source_key <> '{}'::jsonb OR NEW.evidence <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'runtime migration rows may persist digests and reason codes only'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.ledger_key IS NOT NULL AND NEW.reason_code !~ '^[A-Z0-9_]{1,128}$' THEN
        RAISE EXCEPTION 'runtime migration reason_code must be a stable non-sensitive code'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_TABLE_NAME = 'ledger'
       AND EXISTS (SELECT 1 FROM migration.run WHERE id = NEW.run_id AND mode = 'dry-run')
       AND (NEW.outcome IN ('migrated', 'linked_existing') OR NEW.target_type IS NOT NULL OR NEW.target_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'dry-run ledger rows cannot claim a canonical target mutation'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION migration.reject_runtime_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.ledger_key IS NOT NULL THEN
        RAISE EXCEPTION 'runtime migration ledger rows are immutable'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER migration_ledger_runtime_metadata_only
    BEFORE INSERT OR UPDATE ON migration.ledger
    FOR EACH ROW EXECUTE FUNCTION migration.enforce_runtime_metadata_only();

CREATE TRIGGER migration_ledger_runtime_immutable
    BEFORE UPDATE OR DELETE ON migration.ledger
    FOR EACH ROW EXECUTE FUNCTION migration.reject_runtime_ledger_mutation();

CREATE TRIGGER migration_conflict_runtime_metadata_only
    BEFORE INSERT OR UPDATE ON migration.conflict
    FOR EACH ROW EXECUTE FUNCTION migration.enforce_runtime_metadata_only();

COMMENT ON COLUMN migration.ledger.ledger_key IS
    'Deterministic SHA-256 idempotency key; never a raw legacy source key.';
COMMENT ON COLUMN migration.ledger.source_key_digest IS
    'SHA-256 digest of the canonical legacy key; never the raw key or row payload.';
COMMENT ON COLUMN migration.conflict.source_key_digest IS
    'SHA-256 digest only; conflict rows must not contain source payload or PII.';
