-- Product decision 2026-08-07: SUPER_ADMIN can inspect every CRM working
-- screen, while CRM business mutations remain owned by CRM specialists/admins.
-- The existing platform_superadmin assignment is scope_type=all, so exact
-- permission grants are sufficient; no authorization bypass is introduced.
INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('platform_superadmin', 'crm.case.list'),
    ('platform_superadmin', 'crm.case.read'),
    ('platform_superadmin', 'crm.person.pii_view'),
    ('platform_superadmin', 'crm.employer.read'),
    ('platform_superadmin', 'crm.task.read'),
    ('platform_superadmin', 'crm.communication.read'),
    ('platform_superadmin', 'crm.dashboard.read'),
    ('platform_superadmin', 'crm.notification.read'),
    ('platform_superadmin', 'crm.report.build')
ON CONFLICT (role_code, permission_code) DO NOTHING;

UPDATE identity.role
SET description = 'Продуктовая роль SUPER_ADMIN: управление пользователями и контентом, all-scope чтение CRM и построение отчётов без CRM business-write прав'
WHERE code = 'platform_superadmin';
