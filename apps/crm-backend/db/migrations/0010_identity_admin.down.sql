DELETE FROM identity.role_permission
WHERE role_code = 'platform_superadmin'
  AND permission_code IN (
    'identity.profile.read_self',
    'identity.profile.update_self',
    'identity.sessions.read_self',
    'identity.sessions.revoke_self',
    'identity.users.read',
    'identity.users.invite',
    'identity.users.update',
    'identity.users.disable',
    'identity.users.enable',
    'identity.credentials.reset',
    'identity.mfa.reset',
    'identity.sessions.read_all',
    'identity.sessions.revoke_all',
    'identity.approvals.read',
    'identity.approvals.decide'
  );

DELETE FROM identity.permission
WHERE code IN (
    'identity.profile.read_self',
    'identity.profile.update_self',
    'identity.sessions.read_self',
    'identity.sessions.revoke_self',
    'identity.users.read',
    'identity.users.invite',
    'identity.users.update',
    'identity.users.disable',
    'identity.users.enable',
    'identity.credentials.reset',
    'identity.mfa.reset',
    'identity.sessions.read_all',
    'identity.sessions.revoke_all',
    'identity.approvals.read',
    'identity.approvals.decide'
);

DROP INDEX IF EXISTS identity.approval_registry_keyset_idx;
DROP INDEX IF EXISTS identity.user_registry_state_idx;
DROP INDEX IF EXISTS identity.user_registry_keyset_idx;
DROP TABLE IF EXISTS identity.bootstrap_ceremony;

DELETE FROM identity.role
WHERE code = 'project_admin'
  AND NOT EXISTS (
    SELECT 1 FROM identity.user_role_assignment assignment WHERE assignment.role_code = 'project_admin'
  );
