CREATE INDEX IF NOT EXISTS migration_run_read_idx
    ON migration.run (started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS migration_conflict_read_idx
    ON migration.conflict (created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS audit_event_read_idx
    ON platform.audit_event (occurred_at DESC, id DESC);

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('migration.run.read', 'migration', 'Read migration runs within an assigned run or audit scope'),
    ('migration.conflict.read', 'migration', 'Read redacted migration conflicts within an assigned run'),
    ('audit.events.read', 'audit', 'Read redacted audit events within an approved audit scope'),
    ('platform.metrics.read', 'platform', 'Read aggregate application metrics without PII or secrets')
ON CONFLICT (code) DO NOTHING;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('migration_operator', 'migration.run.read'),
    ('migration_operator', 'migration.conflict.read'),
    ('audit_reader', 'migration.run.read'),
    ('audit_reader', 'audit.events.read'),
    ('platform_superadmin', 'platform.metrics.read')
ON CONFLICT (role_code, permission_code) DO NOTHING;
