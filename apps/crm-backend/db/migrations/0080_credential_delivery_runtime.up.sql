CREATE TABLE identity.credential_delivery (
    outbox_event_id uuid PRIMARY KEY REFERENCES platform.outbox_event(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('retry_wait', 'delivered', 'dead_lettered')),
    attempt_count integer NOT NULL CHECK (attempt_count > 0),
    next_attempt_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,96}$'),
    provider_reference text CHECK (
        provider_reference IS NULL OR provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    delivered_at timestamptz,
    dead_lettered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (state = 'retry_wait' AND next_attempt_at IS NOT NULL AND last_error_code IS NOT NULL
            AND delivered_at IS NULL AND dead_lettered_at IS NULL)
        OR (state = 'delivered' AND next_attempt_at IS NULL AND last_error_code IS NULL
            AND delivered_at IS NOT NULL AND dead_lettered_at IS NULL)
        OR (state = 'dead_lettered' AND next_attempt_at IS NULL AND last_error_code IS NOT NULL
            AND delivered_at IS NULL AND dead_lettered_at IS NOT NULL)
    )
);

CREATE INDEX credential_delivery_retry_idx
    ON identity.credential_delivery (next_attempt_at, outbox_event_id)
    WHERE state = 'retry_wait';

REVOKE ALL ON identity.credential_delivery FROM PUBLIC;

-- 0050 grants API/general-worker defaults broadly. This security boundary is
-- deliberately narrowed for the credential delivery receipt and a dedicated
-- runtime principal gets only the columns required by its queue adapter.
DO $credential_worker_grants$
DECLARE
    base_runtime_role_count integer;
BEGIN
    SELECT count(*)::integer
    INTO base_runtime_role_count
    FROM pg_roles
    WHERE rolname IN ('kurs_crm_migrator', 'kurs_crm_api', 'kurs_crm_worker');

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') THEN
        EXECUTE 'REVOKE ALL ON identity.credential_delivery FROM kurs_crm_api';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker') THEN
        EXECUTE 'REVOKE ALL ON identity.credential_delivery FROM kurs_crm_worker';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_credential_worker') THEN
        IF base_runtime_role_count > 0 THEN
            RAISE EXCEPTION USING
                MESSAGE = 'kurs_crm_credential_worker must be provisioned before migration 0080',
                HINT = 'Run the reviewed additive role-provisioning procedure before retrying migrations.';
        END IF;
        RAISE NOTICE 'CRM runtime roles are absent; skipping credential-worker deployment grants';
        RETURN;
    END IF;

    EXECUTE 'GRANT USAGE ON SCHEMA identity, platform TO kurs_crm_credential_worker';
    EXECUTE 'GRANT SELECT (id, topic, aggregate_id, payload, idempotency_key, occurred_at, available_at, attempt_count, locked_at, locked_by, delivered_at) ON platform.outbox_event TO kurs_crm_credential_worker';
    EXECUTE 'GRANT UPDATE (available_at, attempt_count, locked_at, locked_by, delivered_at, last_error_code) ON platform.outbox_event TO kurs_crm_credential_worker';
    EXECUTE 'GRANT SELECT (consumer, event_id) ON platform.inbox_event TO kurs_crm_credential_worker';
    EXECUTE 'GRANT INSERT (consumer, event_id, result, processed_at) ON platform.inbox_event TO kurs_crm_credential_worker';
    EXECUTE 'GRANT SELECT (id, user_account_id, purpose, expires_at, used_at, revoked_at) ON identity.password_token TO kurs_crm_credential_worker';
    EXECUTE 'GRANT SELECT (id, email, account_state, credential_state, archived_at) ON identity.user_account TO kurs_crm_credential_worker';
    EXECUTE 'GRANT SELECT (outbox_event_id, state) ON identity.credential_delivery TO kurs_crm_credential_worker';
    EXECUTE 'GRANT INSERT (outbox_event_id, state, attempt_count, next_attempt_at, last_error_code, provider_reference, delivered_at, dead_lettered_at, updated_at) ON identity.credential_delivery TO kurs_crm_credential_worker';
    EXECUTE 'GRANT UPDATE (state, attempt_count, next_attempt_at, last_error_code, provider_reference, delivered_at, dead_lettered_at, updated_at) ON identity.credential_delivery TO kurs_crm_credential_worker';
END
$credential_worker_grants$;
