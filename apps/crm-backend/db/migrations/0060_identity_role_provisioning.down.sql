DROP INDEX IF EXISTS identity.approval_operation_state_idx;
DROP INDEX IF EXISTS identity.identity_role_eligible_lookup_idx;

DELETE FROM identity.role_permission
WHERE (role_code, permission_code) IN (
    ('crm_admin', 'identity.approvals.read'),
    ('crm_admin', 'identity.approvals.decide'),
    ('project_admin', 'identity.approvals.read'),
    ('project_admin', 'identity.approvals.decide')
);

DELETE FROM identity.role_permission
WHERE permission_code IN (
    'identity.roles.preview',
    'identity.roles.assign_platform',
    'identity.roles.assign_crm',
    'identity.roles.revoke_crm',
    'identity.roles.assign_project',
    'identity.roles.revoke_project',
    'identity.roles.assign_initial_crm_admin',
    'identity.roles.assign_initial_project_admin',
    'identity.roles.assign_crm_admin',
    'identity.roles.assign_project_admin',
    'identity.roles.revoke_platform',
    'identity.roles.revoke_crm_admin',
    'identity.roles.revoke_project_admin',
    'identity.roles.assign_migration',
    'identity.roles.revoke_migration',
    'identity.roles.assign_audit',
    'identity.roles.revoke_audit'
);

DELETE FROM identity.permission
WHERE code IN (
    'identity.roles.preview',
    'identity.roles.assign_platform',
    'identity.roles.assign_crm',
    'identity.roles.revoke_crm',
    'identity.roles.assign_project',
    'identity.roles.revoke_project',
    'identity.roles.assign_initial_crm_admin',
    'identity.roles.assign_initial_project_admin',
    'identity.roles.assign_crm_admin',
    'identity.roles.assign_project_admin',
    'identity.roles.revoke_platform',
    'identity.roles.revoke_crm_admin',
    'identity.roles.revoke_project_admin',
    'identity.roles.assign_migration',
    'identity.roles.revoke_migration',
    'identity.roles.assign_audit',
    'identity.roles.revoke_audit'
);

DELETE FROM identity.role AS role
WHERE role.code IN ('project_direction_lead', 'project_manager', 'project_executor')
  AND NOT EXISTS (
      SELECT 1
      FROM identity.user_role_assignment AS assignment
      WHERE assignment.role_code = role.code
  );
