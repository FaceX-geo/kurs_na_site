CREATE TABLE migration.ledger_attempt (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    run_id uuid NOT NULL REFERENCES migration.run(id) ON DELETE RESTRICT,
    ledger_key text NOT NULL REFERENCES migration.ledger(ledger_key) ON DELETE RESTRICT
        CHECK (ledger_key ~ '^[a-f0-9]{64}$'),
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    source_table text NOT NULL CHECK (source_table ~ '^[A-Za-z0-9_]{1,128}$'),
    source_key_digest text NOT NULL CHECK (source_key_digest ~ '^[a-f0-9]{64}$'),
    transform_version text NOT NULL CHECK (transform_version ~ '^[A-Za-z0-9._:-]{1,128}$'),
    projection text NOT NULL CHECK (
        projection IN ('would_migrate', 'would_quarantine', 'would_conflict', 'would_exclude')
    ),
    outcome text NOT NULL CHECK (
        outcome IN ('migrated', 'linked_existing', 'excluded_with_reason', 'conflict_recorded', 'quarantined')
    ),
    reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_]{1,128}$'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (run_id, ledger_key)
);

CREATE INDEX migration_ledger_attempt_run_projection_idx
    ON migration.ledger_attempt (run_id, projection, source_table, attempt_no);
CREATE INDEX migration_ledger_attempt_identity_idx
    ON migration.ledger_attempt (snapshot_sha256, source_table, source_key_digest, transform_version);

CREATE TABLE migration.ledger_target (
    attempt_id uuid NOT NULL REFERENCES migration.ledger_attempt(id) ON DELETE RESTRICT,
    target_ordinal integer NOT NULL CHECK (target_ordinal >= 0),
    target_type text NOT NULL CHECK (target_type ~ '^[A-Za-z][A-Za-z0-9._:-]{0,127}$'),
    target_id uuid,
    target_action text NOT NULL CHECK (target_action IN ('create', 'link', 'stage')),
    projection text NOT NULL CHECK (
        projection IN ('would_migrate', 'would_quarantine', 'would_conflict', 'would_exclude')
    ),
    reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z0-9_]{1,128}$'),
    target_key_digest text NOT NULL CHECK (target_key_digest ~ '^[a-f0-9]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (attempt_id, target_ordinal),
    UNIQUE (attempt_id, target_key_digest),
    CHECK (projection = 'would_migrate' OR reason_code IS NOT NULL)
);

CREATE INDEX migration_ledger_target_type_projection_idx
    ON migration.ledger_target (target_type, projection, attempt_id);

CREATE TRIGGER migration_ledger_attempt_append_only
    BEFORE UPDATE OR DELETE ON migration.ledger_attempt
    FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER migration_ledger_target_append_only
    BEFORE UPDATE OR DELETE ON migration.ledger_target
    FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

COMMENT ON TABLE migration.ledger_attempt IS
    'Append-only per-run dry-run/import decision history; contains digests and stable codes only.';
COMMENT ON TABLE migration.ledger_target IS
    'One-to-many privacy-safe target intents for a ledger attempt; target_id is nullable until a real import links or creates a canonical row.';

DO $runtime_grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') THEN
        EXECUTE 'GRANT SELECT ON migration.ledger_attempt, migration.ledger_target TO kurs_crm_api';
    END IF;
END
$runtime_grants$;
