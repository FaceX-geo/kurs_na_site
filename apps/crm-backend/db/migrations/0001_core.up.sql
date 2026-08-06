CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS intake;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS migration;

REVOKE ALL ON SCHEMA platform, identity, intake, crm, migration FROM PUBLIC;

CREATE TABLE IF NOT EXISTS platform.schema_migration (
    version text PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION platform.touch_versioned_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'append-only relation % cannot be mutated', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TABLE identity.person (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    surname text NOT NULL,
    given_name text NOT NULL,
    middle_name text,
    birth_date date,
    normalized_email citext,
    normalized_phone text,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (normalized_phone IS NULL OR normalized_phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE INDEX person_email_idx ON identity.person (normalized_email) WHERE archived_at IS NULL;
CREATE INDEX person_phone_idx ON identity.person (normalized_phone) WHERE archived_at IS NULL;

CREATE TABLE identity.employee_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id uuid NOT NULL UNIQUE REFERENCES identity.person(id) ON DELETE RESTRICT,
    employee_number text UNIQUE,
    organization_unit_id uuid,
    employment_state text NOT NULL CHECK (employment_state IN ('active', 'inactive', 'pending_review')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE TABLE identity.user_account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id uuid NOT NULL UNIQUE REFERENCES identity.person(id) ON DELETE RESTRICT,
    email citext NOT NULL UNIQUE,
    username citext UNIQUE,
    password_hash text,
    account_state text NOT NULL CHECK (account_state IN ('active', 'disabled', 'archived')),
    credential_state text NOT NULL CHECK (credential_state IN ('invited', 'password_set', 'change_required', 'expired')),
    risk_state text NOT NULL CHECK (risk_state IN ('normal', 'locked')),
    mfa_state text NOT NULL CHECK (mfa_state IN ('not_enrolled', 'enrollment_required', 'enrolled', 'recovery_required')),
    failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((credential_state = 'invited' AND password_hash IS NULL) OR credential_state <> 'invited')
);

CREATE TABLE identity.session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE CHECK (length(token_hash) >= 43),
    csrf_token_hash text NOT NULL CHECK (length(csrf_token_hash) >= 43),
    authentication_level text NOT NULL CHECK (authentication_level IN ('password', 'mfa', 'fresh_mfa')),
    user_agent_hash text,
    ip_prefix text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoke_reason text,
    CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE INDEX session_active_idx ON identity.session (user_account_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE identity.role (
    code text PRIMARY KEY,
    domain text NOT NULL CHECK (domain IN ('platform', 'crm', 'project', 'migration', 'audit')),
    title text NOT NULL,
    description text NOT NULL,
    is_privileged boolean NOT NULL DEFAULT false
);

CREATE TABLE identity.permission (
    code text PRIMARY KEY,
    domain text NOT NULL CHECK (domain IN ('platform', 'identity', 'crm', 'project', 'migration', 'audit', 'integration', 'ai')),
    description text NOT NULL
);

CREATE TABLE identity.role_permission (
    role_code text NOT NULL REFERENCES identity.role(code) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES identity.permission(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE identity.user_role_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    role_code text NOT NULL REFERENCES identity.role(code) ON DELETE RESTRICT,
    scope_type text NOT NULL CHECK (scope_type IN ('self', 'assigned', 'team', 'department', 'direction', 'project', 'all')),
    scope_id uuid,
    valid_from timestamptz NOT NULL DEFAULT clock_timestamp(),
    valid_to timestamptz,
    assigned_by uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((scope_type IN ('self', 'all') AND scope_id IS NULL) OR scope_type NOT IN ('self', 'all')),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX active_user_role_scope_uidx
    ON identity.user_role_assignment (user_account_id, role_code, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE valid_to IS NULL AND archived_at IS NULL;

CREATE TABLE intake.upload (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    storage_key text NOT NULL UNIQUE,
    original_name text NOT NULL,
    media_type text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    scan_state text NOT NULL CHECK (scan_state IN ('quarantined', 'clean', 'rejected', 'scan_failed')),
    linked_submission_id uuid,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE intake.submission (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    schema_version text NOT NULL,
    applicant_type text NOT NULL CHECK (applicant_type IN ('relocation', 'student')),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    normalized_email_hash text NOT NULL CHECK (normalized_email_hash ~ '^[a-f0-9]{64}$'),
    normalized_phone_hash text NOT NULL CHECK (normalized_phone_hash ~ '^[a-f0-9]{64}$'),
    consent_policy_version text,
    consent_accepted_at timestamptz,
    source_code text NOT NULL,
    entry_point_code text,
    vacancy_id text,
    status text NOT NULL CHECK (status IN ('received', 'routing', 'routed', 'needs_review', 'rejected')),
    routed_case_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((consent_policy_version IS NULL) = (consent_accepted_at IS NULL))
);

ALTER TABLE intake.upload
    ADD CONSTRAINT upload_submission_fk
    FOREIGN KEY (linked_submission_id) REFERENCES intake.submission(id) ON DELETE SET NULL;

CREATE INDEX intake_submission_queue_idx ON intake.submission (status, created_at, id);

CREATE TABLE crm.profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id uuid NOT NULL UNIQUE REFERENCES identity.person(id) ON DELETE RESTRICT,
    profile_state text NOT NULL CHECK (profile_state IN ('active', 'inactive', 'archived')),
    data_quality_state text NOT NULL CHECK (data_quality_state IN ('verified', 'needs_review', 'conflict')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE TABLE crm.program_participation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_profile_id uuid NOT NULL REFERENCES crm.profile(id) ON DELETE RESTRICT,
    program_type text NOT NULL CHECK (program_type IN ('relocation', 'student', 'recommender', 'post_relocation')),
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE crm.candidate_source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    crm_profile_id uuid NOT NULL REFERENCES crm.profile(id) ON DELETE RESTRICT,
    submission_id uuid REFERENCES intake.submission(id) ON DELETE SET NULL,
    source_code text NOT NULL,
    entry_point_code text,
    vacancy_id text,
    first_touch jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(first_touch) = 'object'),
    last_touch jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(last_touch) = 'object'),
    consent_policy_version text,
    consent_accepted_at timestamptz,
    consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(consent_evidence) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((consent_policy_version IS NULL) = (consent_accepted_at IS NULL))
);

CREATE TABLE crm."case" (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    participation_id uuid REFERENCES crm.program_participation(id) ON DELETE RESTRICT,
    funnel_code text NOT NULL,
    funnel_version integer NOT NULL CHECK (funnel_version > 0),
    stage_code text NOT NULL,
    title text NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'completed', 'closed_unsuccessful', 'archived', 'needs_review')),
    next_step text,
    source_created_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

ALTER TABLE intake.submission
    ADD CONSTRAINT submission_routed_case_fk
    FOREIGN KEY (routed_case_id) REFERENCES crm."case"(id) ON DELETE SET NULL;

CREATE INDEX crm_case_registry_idx ON crm."case" (funnel_code, stage_code, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE TABLE crm.case_person (
    case_id uuid NOT NULL REFERENCES crm."case"(id) ON DELETE CASCADE,
    person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    relationship_type text NOT NULL CHECK (relationship_type IN ('candidate', 'student', 'recommender', 'household_member', 'other')),
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (case_id, person_id, relationship_type)
);

CREATE UNIQUE INDEX case_primary_person_uidx ON crm.case_person (case_id) WHERE is_primary;

CREATE TABLE migration.legacy_actor (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_user_id text NOT NULL UNIQUE,
    display_label text NOT NULL,
    classification text NOT NULL CHECK (classification IN ('active_employee', 'inactive_employee', 'service', 'external', 'duplicate', 'manual_review', 'excluded')),
    employee_profile_id uuid REFERENCES identity.employee_profile(id) ON DELETE SET NULL,
    provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE crm.case_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL REFERENCES crm."case"(id) ON DELETE CASCADE,
    employee_profile_id uuid REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    legacy_actor_id uuid REFERENCES migration.legacy_actor(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('owner', 'curator', 'observer', 'creator', 'modifier')),
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((employee_profile_id IS NOT NULL)::integer + (legacy_actor_id IS NOT NULL)::integer = 1),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX current_case_assignment_uidx ON crm.case_assignment (case_id, role)
    WHERE valid_to IS NULL AND archived_at IS NULL AND role IN ('owner', 'curator');

CREATE TABLE crm.case_stage_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL REFERENCES crm."case"(id) ON DELETE CASCADE,
    from_stage_code text,
    to_stage_code text NOT NULL,
    reason_code text,
    reason_text text,
    actor_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    source_stage text,
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (case_id, aggregate_version)
);

CREATE INDEX case_stage_timeline_idx ON crm.case_stage_history (case_id, occurred_at DESC, id DESC);

CREATE TABLE crm.employer (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    name text NOT NULL,
    legal_name text,
    normalized_tax_id text,
    status text NOT NULL CHECK (status IN ('active', 'inactive', 'needs_review', 'archived')),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (normalized_tax_id IS NULL OR normalized_tax_id ~ '^[0-9]{10}([0-9]{2})?$')
);

CREATE UNIQUE INDEX employer_tax_id_uidx ON crm.employer (normalized_tax_id)
    WHERE normalized_tax_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE crm.employer_contact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_id uuid NOT NULL REFERENCES crm.employer(id) ON DELETE CASCADE,
    person_id uuid REFERENCES identity.person(id) ON DELETE SET NULL,
    name text NOT NULL,
    position text,
    email citext,
    phone text,
    is_primary boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE TABLE crm.employer_referral (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    case_id uuid REFERENCES crm."case"(id) ON DELETE RESTRICT,
    person_id uuid REFERENCES identity.person(id) ON DELETE RESTRICT,
    employer_id uuid REFERENCES crm.employer(id) ON DELETE RESTRICT,
    owner_employee_profile_id uuid REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    stage_code text NOT NULL,
    channel_code text,
    vacancy_title text,
    sent_at timestamptz,
    result_at timestamptz,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (case_id IS NOT NULL OR person_id IS NOT NULL)
);

CREATE INDEX referral_registry_idx ON crm.employer_referral (stage_code, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE TABLE crm.relocation_profile (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL UNIQUE REFERENCES crm."case"(id) ON DELETE CASCADE,
    employer_id uuid REFERENCES crm.employer(id) ON DELETE RESTRICT,
    position text,
    municipality text,
    locality text,
    planned_date date,
    actual_date date,
    household jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(household) = 'object'),
    tickets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tickets) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE TABLE crm.task (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    case_id uuid REFERENCES crm."case"(id) ON DELETE RESTRICT,
    employer_referral_id uuid REFERENCES crm.employer_referral(id) ON DELETE RESTRICT,
    title text NOT NULL,
    description text,
    state text NOT NULL CHECK (state IN ('to_do', 'in_progress', 'done', 'cancelled')),
    responsible_employee_profile_id uuid REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    due_at timestamptz,
    completed_at timestamptz,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((state = 'done' AND completed_at IS NOT NULL) OR state <> 'done')
);

CREATE INDEX crm_task_registry_idx ON crm.task (state, due_at NULLS LAST, id) WHERE archived_at IS NULL;

CREATE TABLE crm.activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    case_id uuid REFERENCES crm."case"(id) ON DELETE CASCADE,
    person_id uuid REFERENCES identity.person(id) ON DELETE CASCADE,
    employer_id uuid REFERENCES crm.employer(id) ON DELETE CASCADE,
    employer_referral_id uuid REFERENCES crm.employer_referral(id) ON DELETE CASCADE,
    activity_type text NOT NULL,
    direction text,
    subject text,
    body_copy text,
    delivery_state text,
    occurred_at timestamptz NOT NULL,
    actor_employee_profile_id uuid REFERENCES identity.employee_profile(id) ON DELETE RESTRICT,
    legacy_actor_id uuid REFERENCES migration.legacy_actor(id) ON DELETE RESTRICT,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (case_id IS NOT NULL OR person_id IS NOT NULL OR employer_id IS NOT NULL OR employer_referral_id IS NOT NULL)
);

CREATE INDEX activity_timeline_idx ON crm.activity (occurred_at DESC, id DESC);
CREATE INDEX activity_case_timeline_idx ON crm.activity (case_id, occurred_at DESC, id DESC);

CREATE TABLE crm.duplicate_candidate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    left_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    right_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    match_reasons jsonb NOT NULL CHECK (jsonb_typeof(match_reasons) = 'array'),
    confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    state text NOT NULL CHECK (state IN ('open', 'confirmed_duplicate', 'kept_separate', 'superseded')),
    resolution jsonb,
    reviewed_by uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (left_person_id < right_person_id),
    UNIQUE (left_person_id, right_person_id)
);

CREATE TABLE platform.audit_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    subject_type text NOT NULL,
    subject_id uuid,
    request_id text,
    reason text,
    before_state jsonb,
    after_state jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    policy_version text,
    scope_snapshot jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    previous_hash text,
    event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX audit_subject_idx ON platform.audit_event (subject_type, subject_id, occurred_at DESC, id DESC);
CREATE INDEX audit_actor_idx ON platform.audit_event (actor_id, occurred_at DESC, id DESC);

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON platform.audit_event
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TABLE platform.outbox_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    idempotency_key text NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    locked_at timestamptz,
    locked_by text,
    delivered_at timestamptz,
    last_error_code text
);

CREATE INDEX outbox_delivery_idx ON platform.outbox_event (available_at, occurred_at, id)
    WHERE delivered_at IS NULL;

CREATE TABLE platform.inbox_event (
    consumer text NOT NULL,
    event_id uuid NOT NULL REFERENCES platform.outbox_event(id) ON DELETE RESTRICT,
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE platform.idempotency_record (
    scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    response_status integer,
    response_body jsonb,
    resource_id uuid,
    state text NOT NULL CHECK (state IN ('processing', 'completed', 'failed')),
    locked_until timestamptz,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (scope, idempotency_key),
    CHECK ((state = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL) OR state <> 'completed')
);

CREATE INDEX idempotency_expiry_idx ON platform.idempotency_record (expires_at);

CREATE TABLE platform.legacy_reference (
    source_system text NOT NULL CHECK (source_system = 'bitrix'),
    source_entity text NOT NULL,
    source_id text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (source_system, source_entity, source_id),
    UNIQUE (source_system, target_type, target_id)
);

CREATE TABLE migration.run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    source_system text NOT NULL CHECK (source_system = 'bitrix'),
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    manifest_version text NOT NULL,
    transform_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('created', 'profiling', 'dry_running', 'awaiting_conflicts', 'ready_for_rehearsal', 'rehearsing', 'ready_for_cutover', 'cutting_over', 'completed', 'failed', 'rolled_back', 'cancelled')),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
    blockers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array')
);

CREATE TABLE migration.ledger (
    run_id uuid NOT NULL REFERENCES migration.run(id) ON DELETE RESTRICT,
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
    source_table text NOT NULL,
    source_key jsonb NOT NULL CHECK (jsonb_typeof(source_key) = 'object'),
    source_key_hash text NOT NULL CHECK (source_key_hash ~ '^[a-f0-9]{64}$'),
    transform_version text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('migrated', 'linked_existing', 'excluded_with_reason', 'conflict_recorded', 'quarantined')),
    target_type text,
    target_id uuid,
    reason_code text,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (snapshot_sha256, source_table, source_key_hash, transform_version),
    CHECK ((outcome IN ('migrated', 'linked_existing') AND target_id IS NOT NULL AND target_type IS NOT NULL) OR outcome NOT IN ('migrated', 'linked_existing')),
    CHECK ((outcome IN ('excluded_with_reason', 'conflict_recorded', 'quarantined') AND reason_code IS NOT NULL) OR outcome NOT IN ('excluded_with_reason', 'conflict_recorded', 'quarantined'))
);

CREATE INDEX migration_ledger_run_outcome_idx ON migration.ledger (run_id, outcome, source_table);

CREATE TABLE migration.conflict (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES migration.run(id) ON DELETE RESTRICT,
    conflict_type text NOT NULL,
    source_table text NOT NULL,
    source_key jsonb NOT NULL CHECK (jsonb_typeof(source_key) = 'object'),
    severity text NOT NULL CHECK (severity IN ('blocking', 'warning')),
    state text NOT NULL CHECK (state IN ('open', 'assigned', 'resolved', 'rejected', 'waived', 'superseded')),
    reason_code text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    assigned_to uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    resolution jsonb,
    resolved_by uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    resolved_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz
);

CREATE INDEX migration_conflict_queue_idx ON migration.conflict (run_id, state, severity, created_at, id)
    WHERE archived_at IS NULL;

DO $$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'identity.person',
        'identity.employee_profile',
        'identity.user_account',
        'identity.user_role_assignment',
        'crm.profile',
        'crm.program_participation',
        'crm.candidate_source',
        'crm."case"',
        'crm.case_assignment',
        'crm.employer',
        'crm.employer_contact',
        'crm.employer_referral',
        'crm.relocation_profile',
        'crm.task',
        'crm.duplicate_candidate',
        'migration.conflict'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER touch_versioned_row BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row()',
            relation_name
        );
    END LOOP;
END;
$$;

INSERT INTO identity.role (code, domain, title, description, is_privileged)
VALUES
    ('platform_superadmin', 'platform', 'Суперадминистратор платформы', 'Управление lifecycle учётных записей без автоматического доступа к CRM', true),
    ('crm_project_manager', 'crm', 'Специалист CRM', 'Назначенные дела и задачи CRM', false),
    ('crm_lead_specialist', 'crm', 'Ведущий специалист CRM', 'Командная работа и отчёты в пределах scope', false),
    ('crm_admin', 'crm', 'Администратор CRM', 'Воронки, поля, права и интеграции CRM', true),
    ('crm_department_head', 'crm', 'Руководитель CRM', 'Дашборды, отчёты и согласованный экспорт', false),
    ('migration_operator', 'migration', 'Оператор миграции', 'Репетиции, конфликты и сверка без управления аккаунтами', true),
    ('audit_reader', 'audit', 'Аудитор', 'Чтение разрешённых событий аудита', true)
ON CONFLICT (code) DO NOTHING;
