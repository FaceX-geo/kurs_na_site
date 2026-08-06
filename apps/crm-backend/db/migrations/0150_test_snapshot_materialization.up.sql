CREATE TABLE migration.test_snapshot_materialization (
    snapshot_sha256 text PRIMARY KEY CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    source_completed_at date NOT NULL,
    environment text NOT NULL CHECK (environment = 'test'),
    state text NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
    source_table_count integer NOT NULL CHECK (source_table_count > 0),
    counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
    failure_code text,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    CHECK ((state = 'completed' AND finished_at IS NOT NULL AND failure_code IS NULL) OR state <> 'completed'),
    CHECK ((state = 'failed' AND finished_at IS NOT NULL AND failure_code IS NOT NULL) OR state <> 'failed')
);

COMMENT ON TABLE migration.test_snapshot_materialization IS
    'Explicitly test-only, idempotent materialization of a pinned legacy snapshot into canonical CRM tables.';

REVOKE ALL ON TABLE migration.test_snapshot_materialization FROM PUBLIC;
