DELETE FROM identity.role_permission
WHERE role_code = 'platform_superadmin'
  AND permission_code IN (
      'crm.case.list',
      'crm.case.read',
      'crm.person.pii_view',
      'crm.employer.read',
      'crm.task.read',
      'crm.communication.read',
      'crm.dashboard.read',
      'crm.notification.read',
      'crm.report.build'
  );

UPDATE identity.role
SET description = 'Продуктовая роль SUPER_ADMIN: управление пользователями и сотрудниками без неявного CRM-доступа'
WHERE code = 'platform_superadmin';
