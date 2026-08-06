DELETE FROM identity.role_permission
WHERE (role_code, permission_code) IN (
    ('migration_operator', 'migration.run.read'),
    ('migration_operator', 'migration.conflict.read'),
    ('audit_reader', 'migration.run.read'),
    ('audit_reader', 'audit.events.read'),
    ('platform_superadmin', 'platform.metrics.read')
);

DELETE FROM identity.permission
WHERE code IN (
    'migration.run.read',
    'migration.conflict.read',
    'audit.events.read',
    'platform.metrics.read'
);

DROP INDEX IF EXISTS platform.audit_event_read_idx;
DROP INDEX IF EXISTS migration.migration_conflict_read_idx;
DROP INDEX IF EXISTS migration.migration_run_read_idx;
