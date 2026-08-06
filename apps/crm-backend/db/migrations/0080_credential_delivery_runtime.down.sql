DO $credential_worker_grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_credential_worker') THEN
        EXECUTE 'REVOKE SELECT (outbox_event_id, state) ON identity.credential_delivery FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE INSERT (outbox_event_id, state, attempt_count, next_attempt_at, last_error_code, provider_reference, delivered_at, dead_lettered_at, updated_at) ON identity.credential_delivery FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE UPDATE (state, attempt_count, next_attempt_at, last_error_code, provider_reference, delivered_at, dead_lettered_at, updated_at) ON identity.credential_delivery FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE SELECT (id, topic, aggregate_id, payload, idempotency_key, occurred_at, available_at, attempt_count, locked_at, locked_by, delivered_at) ON platform.outbox_event FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE UPDATE (available_at, attempt_count, locked_at, locked_by, delivered_at, last_error_code) ON platform.outbox_event FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE SELECT (consumer, event_id) ON platform.inbox_event FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE INSERT (consumer, event_id, result, processed_at) ON platform.inbox_event FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE SELECT (id, user_account_id, purpose, expires_at, used_at, revoked_at) ON identity.password_token FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE SELECT (id, email, account_state, credential_state, archived_at) ON identity.user_account FROM kurs_crm_credential_worker';
        EXECUTE 'REVOKE USAGE ON SCHEMA identity, platform FROM kurs_crm_credential_worker';
    END IF;
END
$credential_worker_grants$;

DROP INDEX IF EXISTS identity.credential_delivery_retry_idx;
DROP TABLE IF EXISTS identity.credential_delivery;
