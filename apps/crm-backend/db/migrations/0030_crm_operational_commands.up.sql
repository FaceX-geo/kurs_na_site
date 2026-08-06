-- Operational CRM command/read-model support required by CRM-03/07/08/09/10/11/12/13.
-- Existing aggregates are extended in place; new workflow records remain typed and versioned.

ALTER TABLE crm."case"
    ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(attributes) = 'object');

ALTER TABLE crm.employer
    ADD COLUMN organization_type text NOT NULL DEFAULT 'legal_entity'
        CHECK (organization_type IN ('legal_entity', 'branch', 'individual_entrepreneur')),
    ADD COLUMN manual_review_reason text;

ALTER TABLE crm.employer_referral
    ADD COLUMN comment text;

ALTER TABLE crm.relocation_profile
    ADD COLUMN offer_status text,
    ADD COLUMN employment_status text,
    ADD COLUMN support_measures jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(support_measures) = 'array'),
    ADD COLUMN result_code text,
    ADD COLUMN result_reason text;

ALTER TABLE crm.task
    ADD COLUMN priority text NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Moscow',
    ADD COLUMN creator_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT;

CREATE TABLE crm.employer_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id uuid NOT NULL REFERENCES crm.employer(id) ON DELETE CASCADE,
    employee_profile_id uuid NOT NULL REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('owner', 'responsible', 'observer')),
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX employer_current_assignment_uidx
    ON crm.employer_assignment (employer_id, role)
    WHERE valid_to IS NULL AND archived_at IS NULL AND role IN ('owner', 'responsible');
CREATE INDEX employer_assignment_employee_idx
    ON crm.employer_assignment (employee_profile_id, employer_id)
    WHERE valid_to IS NULL AND archived_at IS NULL;
CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON crm.employer_assignment
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TABLE crm.employer_referral_stage_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_referral_id uuid NOT NULL REFERENCES crm.employer_referral(id) ON DELETE CASCADE,
    from_stage_code text,
    to_stage_code text NOT NULL,
    reason_code text,
    reason_text text,
    actor_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (employer_referral_id, aggregate_version)
);

CREATE TABLE crm.task_participant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES crm.task(id) ON DELETE CASCADE,
    employee_profile_id uuid NOT NULL REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('participant', 'observer')),
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX task_current_participant_uidx
    ON crm.task_participant (task_id, employee_profile_id, role)
    WHERE valid_to IS NULL;

CREATE TABLE crm.task_checklist_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES crm.task(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(trim(title)) > 0),
    completed boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position >= 0),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    UNIQUE (task_id, position)
);

CREATE TABLE crm.task_comment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    task_id uuid NOT NULL REFERENCES crm.task(id) ON DELETE CASCADE,
    body text NOT NULL CHECK (length(trim(body)) > 0),
    author_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE TABLE crm.task_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES crm.task(id) ON DELETE CASCADE,
    change_type text NOT NULL,
    before_state jsonb,
    after_state jsonb,
    actor_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (task_id, aggregate_version, change_type)
);

CREATE TABLE crm.communication_draft (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    channel text NOT NULL CHECK (channel IN ('email', 'max')),
    subject text,
    body text NOT NULL CHECK (length(trim(body)) > 0),
    selection jsonb NOT NULL CHECK (jsonb_typeof(selection) = 'object'),
    selection_fingerprint text NOT NULL CHECK (selection_fingerprint ~ '^[a-f0-9]{64}$'),
    state text NOT NULL CHECK (state IN ('draft', 'confirmed', 'queued', 'cancelled')),
    created_by_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    confirmed_by_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    confirmed_at timestamptz,
    queued_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (
        (state = 'draft' AND confirmed_at IS NULL)
        OR state = 'cancelled'
        OR (state IN ('confirmed', 'queued') AND confirmed_at IS NOT NULL)
    ),
    CHECK (state <> 'queued' OR queued_at IS NOT NULL)
);

CREATE TABLE crm.communication_recipient (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id uuid NOT NULL REFERENCES crm.communication_draft(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('selected', 'queued', 'sent', 'delivered', 'failed', 'skipped')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code text,
    queued_event_id uuid REFERENCES platform.outbox_event(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (draft_id, person_id)
);

CREATE TABLE crm.notification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    recipient_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    type_code text NOT NULL,
    title text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    read_at timestamptz,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE crm.report_run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    report_code text NOT NULL,
    formula_version text NOT NULL,
    timezone text NOT NULL,
    filters jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
    scope_snapshot jsonb NOT NULL CHECK (jsonb_typeof(scope_snapshot) = 'object'),
    state text NOT NULL CHECK (state IN ('completed', 'failed')),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    excluded_records integer NOT NULL DEFAULT 0 CHECK (excluded_records >= 0),
    data_fresh_at timestamptz NOT NULL,
    created_by_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE crm.setting_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_code text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
    state text NOT NULL CHECK (state IN ('draft', 'active', 'retired')),
    reason text NOT NULL,
    created_by_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (setting_code, version)
);

CREATE UNIQUE INDEX crm_setting_single_active_uidx
    ON crm.setting_version (setting_code)
    WHERE state = 'active';
CREATE INDEX referral_history_timeline_idx
    ON crm.employer_referral_stage_history (employer_referral_id, occurred_at DESC, id DESC);
CREATE INDEX task_participant_employee_idx
    ON crm.task_participant (employee_profile_id, task_id);
CREATE INDEX task_comment_timeline_idx
    ON crm.task_comment (task_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;
CREATE INDEX communication_draft_registry_idx
    ON crm.communication_draft (state, created_at DESC, id DESC)
    WHERE archived_at IS NULL;
CREATE INDEX communication_recipient_queue_idx
    ON crm.communication_recipient (state, created_at, id)
    WHERE state IN ('selected', 'queued', 'failed');
CREATE INDEX notification_recipient_idx
    ON crm.notification (recipient_user_account_id, occurred_at DESC, id DESC);
CREATE INDEX report_run_registry_idx
    ON crm.report_run (created_by_user_account_id, created_at DESC, id DESC);

CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON crm.task_checklist_item
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();
CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON crm.task_comment
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();
CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON crm.communication_draft
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('crm.case.update', 'crm', 'Изменение разрешённых полей CRM-кейса'),
    ('crm.employer.manage', 'crm', 'Создание и изменение работодателей'),
    ('crm.referral.manage', 'crm', 'Создание и переходы направлений работодателям'),
    ('crm.communication.manage', 'crm', 'Создание, подтверждение и постановка CRM-коммуникаций в очередь'),
    ('crm.dashboard.read', 'crm', 'Чтение персонального CRM dashboard'),
    ('crm.notification.read', 'crm', 'Чтение собственных CRM-уведомлений'),
    ('crm.report.build', 'crm', 'Построение проверяемых CRM-отчётов'),
    ('crm.report.export', 'crm', 'Экспорт CRM-отчётов'),
    ('crm.settings.manage', 'crm', 'Управление versioned настройками CRM')
ON CONFLICT (code) DO UPDATE SET
    domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('crm_project_manager', 'crm.case.update'),
    ('crm_project_manager', 'crm.employer.manage'),
    ('crm_project_manager', 'crm.referral.manage'),
    ('crm_project_manager', 'crm.communication.manage'),
    ('crm_project_manager', 'crm.dashboard.read'),
    ('crm_project_manager', 'crm.notification.read'),
    ('crm_lead_specialist', 'crm.case.update'),
    ('crm_lead_specialist', 'crm.employer.manage'),
    ('crm_lead_specialist', 'crm.referral.manage'),
    ('crm_lead_specialist', 'crm.communication.manage'),
    ('crm_lead_specialist', 'crm.dashboard.read'),
    ('crm_lead_specialist', 'crm.notification.read'),
    ('crm_lead_specialist', 'crm.report.build'),
    ('crm_lead_specialist', 'crm.report.export'),
    ('crm_admin', 'crm.case.update'),
    ('crm_admin', 'crm.employer.manage'),
    ('crm_admin', 'crm.referral.manage'),
    ('crm_admin', 'crm.communication.manage'),
    ('crm_admin', 'crm.dashboard.read'),
    ('crm_admin', 'crm.notification.read'),
    ('crm_admin', 'crm.report.build'),
    ('crm_admin', 'crm.report.export'),
    ('crm_admin', 'crm.settings.manage'),
    ('crm_department_head', 'crm.dashboard.read'),
    ('crm_department_head', 'crm.notification.read'),
    ('crm_department_head', 'crm.report.build'),
    ('crm_department_head', 'crm.report.export')
ON CONFLICT (role_code, permission_code) DO NOTHING;
