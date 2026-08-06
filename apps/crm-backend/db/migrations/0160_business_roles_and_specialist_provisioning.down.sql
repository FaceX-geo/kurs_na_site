DROP TRIGGER IF EXISTS enforce_active_business_role_assignment
    ON identity.user_role_assignment;
DROP FUNCTION IF EXISTS identity.enforce_active_business_role_assignment();

ALTER TABLE identity.user_role_assignment
    DROP CONSTRAINT IF EXISTS identity_business_role_interval_excl;

DROP INDEX IF EXISTS identity.employee_provisioning_keyset_idx;

UPDATE identity.role
SET title = 'Суперадминистратор платформы',
    description = 'Управление lifecycle учётных записей без автоматического доступа к CRM'
WHERE code = 'platform_superadmin';

UPDATE identity.role
SET title = 'Специалист CRM',
    description = 'Назначенные дела и задачи CRM'
WHERE code = 'crm_project_manager';

DELETE FROM identity.role_permission
WHERE role_code = 'platform_superadmin'
  AND permission_code IN ('identity.employees.read', 'identity.specialists.provision');

DELETE FROM identity.permission
WHERE code IN ('identity.employees.read', 'identity.specialists.provision');
