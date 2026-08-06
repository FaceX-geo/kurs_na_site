-- Registry-backed role provisioning. Permissions are intentionally separated by
-- domain: platform administrators do not inherit CRM/project business access,
-- and domain administrators do not inherit platform account lifecycle access.
INSERT INTO identity.role (code, domain, title, description, is_privileged)
VALUES
    ('project_direction_lead', 'project', 'Руководитель направления', 'Управление проектами в пределах назначенного направления', false),
    ('project_manager', 'project', 'Руководитель проекта', 'Управление назначенным проектом и его исполнителями', false),
    ('project_executor', 'project', 'Исполнитель проекта', 'Работа с назначенными задачами проекта', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('identity.roles.preview', 'identity', 'Предпросмотр эффективного доступа до изменения роли'),
    ('identity.roles.assign_platform', 'identity', 'Назначение платформенной роли по four-eyes процедуре'),
    ('identity.roles.assign_crm', 'identity', 'Назначение обычной CRM-роли в разрешённой области'),
    ('identity.roles.revoke_crm', 'identity', 'Отзыв обычной CRM-роли в разрешённой области'),
    ('identity.roles.assign_project', 'identity', 'Назначение обычной проектной роли в разрешённой области'),
    ('identity.roles.revoke_project', 'identity', 'Отзыв обычной проектной роли в разрешённой области'),
    ('identity.roles.assign_initial_crm_admin', 'identity', 'Первичное назначение администратора CRM после production bootstrap'),
    ('identity.roles.assign_initial_project_admin', 'identity', 'Первичное назначение администратора проектов после production bootstrap'),
    ('identity.roles.assign_crm_admin', 'identity', 'Назначение дополнительного администратора CRM'),
    ('identity.roles.assign_project_admin', 'identity', 'Назначение дополнительного администратора проектов'),
    ('identity.roles.revoke_platform', 'identity', 'Отзыв платформенной роли с minimum-admin guard'),
    ('identity.roles.revoke_crm_admin', 'identity', 'Отзыв роли администратора CRM с minimum-admin guard'),
    ('identity.roles.revoke_project_admin', 'identity', 'Отзыв роли администратора проектов с minimum-admin guard'),
    ('identity.roles.assign_migration', 'identity', 'Назначение роли оператора миграции по four-eyes процедуре'),
    ('identity.roles.revoke_migration', 'identity', 'Отзыв роли оператора миграции после передачи ответственности'),
    ('identity.roles.assign_audit', 'identity', 'Назначение роли аудитора по four-eyes процедуре'),
    ('identity.roles.revoke_audit', 'identity', 'Отзыв роли аудитора после передачи ответственности')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('platform_superadmin', 'identity.roles.preview'),
    ('platform_superadmin', 'identity.roles.assign_platform'),
    ('platform_superadmin', 'identity.roles.assign_initial_crm_admin'),
    ('platform_superadmin', 'identity.roles.assign_initial_project_admin'),
    ('platform_superadmin', 'identity.roles.assign_crm_admin'),
    ('platform_superadmin', 'identity.roles.assign_project_admin'),
    ('platform_superadmin', 'identity.roles.revoke_platform'),
    ('platform_superadmin', 'identity.roles.revoke_crm_admin'),
    ('platform_superadmin', 'identity.roles.revoke_project_admin'),
    ('platform_superadmin', 'identity.roles.assign_migration'),
    ('platform_superadmin', 'identity.roles.revoke_migration'),
    ('platform_superadmin', 'identity.roles.assign_audit'),
    ('platform_superadmin', 'identity.roles.revoke_audit'),
    ('crm_admin', 'identity.roles.preview'),
    ('crm_admin', 'identity.roles.assign_crm'),
    ('crm_admin', 'identity.roles.revoke_crm'),
    ('crm_admin', 'identity.approvals.read'),
    ('crm_admin', 'identity.approvals.decide'),
    ('project_admin', 'identity.roles.preview'),
    ('project_admin', 'identity.roles.assign_project'),
    ('project_admin', 'identity.roles.revoke_project'),
    ('project_admin', 'identity.approvals.read'),
    ('project_admin', 'identity.approvals.decide'),
    ('project_manager', 'identity.roles.assign_project'),
    ('project_manager', 'identity.roles.revoke_project')
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS identity_role_eligible_lookup_idx
    ON identity.user_role_assignment (role_code, user_account_id, valid_from)
    WHERE valid_to IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS approval_operation_state_idx
    ON identity.approval_request (operation_code, state, expires_at, created_at DESC, id DESC)
    WHERE archived_at IS NULL;
