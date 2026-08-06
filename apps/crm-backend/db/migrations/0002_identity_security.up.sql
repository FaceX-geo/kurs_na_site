CREATE TABLE identity.mfa_factor (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    provider_code text NOT NULL CHECK (provider_code IN ('totp', 'max_otp')),
    state text NOT NULL CHECK (state IN ('pending', 'active', 'recovery_required', 'revoked')),
    secret_ciphertext bytea,
    provider_subject_ref text,
    enrolled_at timestamptz,
    last_used_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (
        (provider_code = 'totp' AND secret_ciphertext IS NOT NULL AND provider_subject_ref IS NULL)
        OR (provider_code = 'max_otp' AND provider_subject_ref IS NOT NULL AND secret_ciphertext IS NULL)
    )
);

CREATE UNIQUE INDEX active_mfa_factor_uidx ON identity.mfa_factor (user_account_id, provider_code)
    WHERE state <> 'revoked' AND archived_at IS NULL;

CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON identity.mfa_factor
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TABLE identity.auth_challenge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    challenge_type text NOT NULL CHECK (challenge_type IN ('mfa_login', 'mfa_enrollment', 'fresh_auth')),
    provider_code text NOT NULL CHECK (provider_code IN ('totp', 'max_otp')),
    token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    state text NOT NULL CHECK (state IN ('pending', 'verified', 'expired', 'locked', 'cancelled')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
    expires_at timestamptz NOT NULL,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX auth_challenge_pending_idx ON identity.auth_challenge (user_account_id, expires_at)
    WHERE state = 'pending';

CREATE TABLE identity.password_token (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('invite', 'reset')),
    token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    created_by uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (purpose <> 'reset' OR reason IS NOT NULL)
);

CREATE INDEX password_token_active_idx ON identity.password_token (user_account_id, purpose, expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE identity.recovery_code (
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE CASCADE,
    code_hash text NOT NULL CHECK (length(code_hash) = 64),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_account_id, code_hash)
);

CREATE TABLE identity.approval_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id text NOT NULL UNIQUE,
    proposer_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    approver_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    subject_id uuid,
    operation_code text NOT NULL,
    permission_code text NOT NULL,
    scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled')),
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    executed_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (approver_id IS NULL OR approver_id <> proposer_id)
);

CREATE TRIGGER touch_versioned_row
BEFORE UPDATE ON identity.approval_request
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();
