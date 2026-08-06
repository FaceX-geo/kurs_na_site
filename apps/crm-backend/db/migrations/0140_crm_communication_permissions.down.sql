ALTER TABLE crm.communication_draft
    DROP CONSTRAINT IF EXISTS communication_confirmation_actor_ck;

DELETE FROM identity.role_permission
WHERE permission_code IN ('crm.communication.confirm', 'crm.communication.send');

DELETE FROM identity.permission
WHERE code IN ('crm.communication.confirm', 'crm.communication.send');

UPDATE identity.permission
SET description = 'Создание, подтверждение и постановка CRM-коммуникаций в очередь'
WHERE code = 'crm.communication.manage';
