ALTER TABLE crm.communication_draft
    ADD CONSTRAINT communication_confirmation_actor_ck
    CHECK (
        state NOT IN ('confirmed', 'queued')
        OR (
            confirmed_by_user_account_id IS NOT NULL
            AND confirmed_by_user_account_id <> created_by_user_account_id
        )
    );

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('crm.communication.confirm', 'crm', 'Подтверждение неизменённого снимка CRM-коммуникации вторым сотрудником'),
    ('crm.communication.send', 'crm', 'Идемпотентная постановка подтверждённой CRM-коммуникации во внутреннюю durable-очередь')
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    description = EXCLUDED.description;

UPDATE identity.permission
SET description = 'Создание и изменение черновиков CRM-коммуникаций'
WHERE code = 'crm.communication.manage';

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('crm_project_manager', 'crm.communication.confirm'),
    ('crm_project_manager', 'crm.communication.send'),
    ('crm_lead_specialist', 'crm.communication.confirm'),
    ('crm_lead_specialist', 'crm.communication.send'),
    ('crm_admin', 'crm.communication.confirm'),
    ('crm_admin', 'crm.communication.send')
ON CONFLICT DO NOTHING;
