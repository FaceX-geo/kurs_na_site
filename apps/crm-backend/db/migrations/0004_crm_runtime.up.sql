INSERT INTO identity.role (code, domain, title, description, is_privileged)
VALUES
    ('crm_project_manager', 'crm', 'Специалист CRM', 'Назначенные дела и задачи CRM', false),
    ('crm_lead_specialist', 'crm', 'Ведущий специалист CRM', 'Командная работа и отчёты в пределах scope', false),
    ('crm_admin', 'crm', 'Администратор CRM', 'Воронки, поля, права и интеграции CRM', true),
    ('crm_department_head', 'crm', 'Руководитель CRM', 'Дашборды, отчёты и согласованный экспорт', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('crm.case.read', 'crm', 'Чтение доступного CRM-кейса'),
    ('crm.case.list', 'crm', 'Чтение реестра доступных CRM-кейсов'),
    ('crm.case.transition', 'crm', 'Выполнение разрешённого перехода CRM-кейса'),
    ('crm.case.reopen', 'crm', 'Возобновление завершённого CRM-кейса'),
    ('crm.person.pii_view', 'crm', 'Чтение разрешённых персональных полей кандидата с аудитом'),
    ('crm.employer.read', 'crm', 'Чтение доступных работодателей и контактов'),
    ('crm.task.read', 'crm', 'Чтение доступных задач CRM'),
    ('crm.task.manage', 'crm', 'Изменение и переходы задач CRM'),
    ('crm.communication.read', 'crm', 'Чтение доступных CRM-коммуникаций')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('crm_project_manager', 'crm.case.read'),
    ('crm_project_manager', 'crm.case.list'),
    ('crm_project_manager', 'crm.case.transition'),
    ('crm_project_manager', 'crm.person.pii_view'),
    ('crm_project_manager', 'crm.employer.read'),
    ('crm_project_manager', 'crm.task.read'),
    ('crm_project_manager', 'crm.task.manage'),
    ('crm_project_manager', 'crm.communication.read'),
    ('crm_lead_specialist', 'crm.case.read'),
    ('crm_lead_specialist', 'crm.case.list'),
    ('crm_lead_specialist', 'crm.case.transition'),
    ('crm_lead_specialist', 'crm.case.reopen'),
    ('crm_lead_specialist', 'crm.person.pii_view'),
    ('crm_lead_specialist', 'crm.employer.read'),
    ('crm_lead_specialist', 'crm.task.read'),
    ('crm_lead_specialist', 'crm.task.manage'),
    ('crm_lead_specialist', 'crm.communication.read'),
    ('crm_admin', 'crm.case.read'),
    ('crm_admin', 'crm.case.list'),
    ('crm_admin', 'crm.case.transition'),
    ('crm_admin', 'crm.case.reopen'),
    ('crm_admin', 'crm.person.pii_view'),
    ('crm_admin', 'crm.employer.read'),
    ('crm_admin', 'crm.task.read'),
    ('crm_admin', 'crm.task.manage'),
    ('crm_admin', 'crm.communication.read'),
    ('crm_department_head', 'crm.case.read'),
    ('crm_department_head', 'crm.case.list'),
    ('crm_department_head', 'crm.person.pii_view'),
    ('crm_department_head', 'crm.employer.read'),
    ('crm_department_head', 'crm.task.read'),
    ('crm_department_head', 'crm.communication.read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS crm_role_assignment_lookup_idx
    ON identity.user_role_assignment (user_account_id, valid_from, valid_to, scope_type, scope_id)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS employee_profile_org_access_idx
    ON identity.employee_profile (organization_unit_id, id)
    WHERE archived_at IS NULL AND employment_state = 'active';

CREATE INDEX IF NOT EXISTS case_assignment_employee_access_idx
    ON crm.case_assignment (employee_profile_id, case_id)
    WHERE valid_to IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS case_person_person_access_idx
    ON crm.case_person (person_id, case_id);

CREATE INDEX IF NOT EXISTS crm_profile_registry_idx
    ON crm.profile (created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS program_participation_profile_idx
    ON crm.program_participation (crm_profile_id, program_type, started_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS employer_registry_idx
    ON crm.employer (created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_case_access_idx
    ON crm.employer_referral (case_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_person_access_idx
    ON crm.employer_referral (person_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_employer_access_idx
    ON crm.employer_referral (employer_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_owner_access_idx
    ON crm.employer_referral (owner_employee_profile_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_task_case_access_idx
    ON crm.task (case_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_task_referral_access_idx
    ON crm.task (employer_referral_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_task_responsible_access_idx
    ON crm.task (responsible_employee_profile_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS activity_person_timeline_idx
    ON crm.activity (person_id, occurred_at DESC, id DESC)
    WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_employer_timeline_idx
    ON crm.activity (employer_id, occurred_at DESC, id DESC)
    WHERE employer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activity_referral_timeline_idx
    ON crm.activity (employer_referral_id, occurred_at DESC, id DESC)
    WHERE employer_referral_id IS NOT NULL;
