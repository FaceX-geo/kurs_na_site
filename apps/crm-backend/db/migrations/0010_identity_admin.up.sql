-- Identity/admin runtime contracts. Production bootstrap intentionally has no
-- HTTP mutation path: trusted ceremony tooling must populate and close this
-- state before the application can have its first eligible superadmins.
CREATE TABLE IF NOT EXISTS identity.bootstrap_ceremony (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    mode text NOT NULL CHECK (mode IN ('production', 'non_production_prototype')),
    state text NOT NULL CHECK (state IN ('pending_acceptance', 'completed', 'closed')),
    first_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    second_person_id uuid REFERENCES identity.person(id) ON DELETE RESTRICT,
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
    owner_approval_ref text NOT NULL,
    ceremony_operator_ref text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    closed_at timestamptz,
    CHECK (second_person_id IS NULL OR second_person_id <> first_person_id),
    CHECK (mode <> 'production' OR second_person_id IS NOT NULL),
    CHECK (state = 'pending_acceptance' OR completed_at IS NOT NULL),
    CHECK (state <> 'closed' OR closed_at IS NOT NULL)
);

REVOKE ALL ON identity.bootstrap_ceremony FROM PUBLIC;

CREATE INDEX IF NOT EXISTS user_registry_keyset_idx
    ON identity.user_account (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_registry_state_idx
    ON identity.user_account (account_state, mfa_state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS approval_registry_keyset_idx
    ON identity.approval_request (state, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

INSERT INTO identity.role (code, domain, title, description, is_privileged)
VALUES
    ('project_admin', 'project', 'Администратор проектов', 'Управление проектным доменом без платформенных прав', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('identity.profile.read_self', 'identity', 'Чтение собственного профиля'),
    ('identity.profile.update_self', 'identity', 'Изменение разрешённых полей собственного профиля'),
    ('identity.sessions.read_self', 'identity', 'Чтение собственных сессий'),
    ('identity.sessions.revoke_self', 'identity', 'Отзыв собственных сессий'),
    ('identity.users.read', 'identity', 'Чтение безопасного реестра пользователей'),
    ('identity.users.invite', 'identity', 'Приглашение пользователя одноразовой ссылкой'),
    ('identity.users.update', 'identity', 'Изменение разрешённых полей пользователя'),
    ('identity.users.disable', 'identity', 'Отключение или архивирование пользователя'),
    ('identity.users.enable', 'identity', 'Активация пользователя'),
    ('identity.credentials.reset', 'identity', 'Административный сброс пароля'),
    ('identity.mfa.reset', 'identity', 'Административный сброс MFA'),
    ('identity.sessions.read_all', 'identity', 'Чтение маскированных сессий пользователя'),
    ('identity.sessions.revoke_all', 'identity', 'Отзыв сессий другого пользователя'),
    ('identity.approvals.read', 'identity', 'Чтение доступных critical approvals'),
    ('identity.approvals.decide', 'identity', 'Подтверждение или отклонение critical approvals')
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
SELECT 'platform_superadmin', permission.code
FROM identity.permission AS permission
WHERE permission.code IN (
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
)
ON CONFLICT (role_code, permission_code) DO NOTHING;
