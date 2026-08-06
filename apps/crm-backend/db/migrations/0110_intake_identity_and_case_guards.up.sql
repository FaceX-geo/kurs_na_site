ALTER TABLE intake.upload
    ADD COLUMN binding_token_hash text,
    ADD COLUMN binding_key_version smallint,
    ADD COLUMN binding_consumed_at timestamptz,
    ADD CONSTRAINT upload_binding_columns_check CHECK (
        (binding_token_hash IS NULL AND binding_key_version IS NULL)
        OR (
            binding_token_hash ~ '^[a-f0-9]{64}$'
            AND binding_key_version IS NOT NULL
            AND binding_key_version > 0
        )
    ),
    ADD CONSTRAINT upload_binding_consumption_check CHECK (
        binding_consumed_at IS NULL OR linked_submission_id IS NOT NULL
    );

COMMENT ON COLUMN intake.upload.binding_token_hash IS
    'Keyed hash of the one-time public upload binding credential. Raw credentials are never persisted.';
COMMENT ON COLUMN intake.upload.binding_key_version IS
    'Derivation version needed to verify or reconstruct an idempotent upload response during key rotation.';
COMMENT ON COLUMN intake.upload.binding_consumed_at IS
    'Timestamp when the upload binding was atomically consumed by an intake submission.';

CREATE OR REPLACE FUNCTION intake.require_binding_for_new_upload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.binding_token_hash IS NULL OR NEW.binding_key_version IS NULL THEN
        RAISE EXCEPTION 'new public uploads require a keyed binding credential hash'
            USING ERRCODE = 'not_null_violation';
    END IF;
    IF NEW.linked_submission_id IS NOT NULL OR NEW.binding_consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'new public uploads must start with an unconsumed binding credential'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER require_binding_for_new_upload_guard
BEFORE INSERT ON intake.upload
FOR EACH ROW
EXECUTE FUNCTION intake.require_binding_for_new_upload();

CREATE TABLE intake.upload_reservation (
    id uuid PRIMARY KEY,
    public_id text NOT NULL UNIQUE,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    storage_key text NOT NULL UNIQUE,
    original_name text NOT NULL,
    media_type text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    binding_token_hash text NOT NULL CHECK (binding_token_hash ~ '^[a-f0-9]{64}$'),
    binding_key_version smallint NOT NULL CHECK (binding_key_version > 0),
    state text NOT NULL CHECK (state IN ('reserved', 'cleanup_pending', 'committed', 'abandoned')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    committed_at timestamptz,
    CHECK ((state = 'committed') = (committed_at IS NOT NULL))
);

CREATE INDEX upload_reservation_reconcile_idx
    ON intake.upload_reservation (state, updated_at, id)
    WHERE state IN ('reserved', 'cleanup_pending');

COMMENT ON TABLE intake.upload_reservation IS
    'Durable DB-first upload lifecycle. It permits exact retry after process/commit ambiguity without persisting file bytes or a raw binding credential.';

CREATE OR REPLACE FUNCTION identity.person_has_user_account(candidate_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM identity.user_account AS account
         WHERE account.person_id = candidate_person_id
    )
$$;

CREATE OR REPLACE FUNCTION identity.person_has_employee_profile(candidate_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM identity.employee_profile AS employee
         WHERE employee.person_id = candidate_person_id
    )
$$;

REVOKE ALL ON FUNCTION identity.person_has_user_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.person_has_employee_profile(uuid) FROM PUBLIC;

DO $runtime_predicate_grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_worker') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION identity.person_has_user_account(uuid) TO kurs_crm_worker';
        EXECUTE 'GRANT EXECUTE ON FUNCTION identity.person_has_employee_profile(uuid) TO kurs_crm_worker';
    END IF;
END
$runtime_predicate_grants$;

CREATE OR REPLACE FUNCTION crm.enforce_one_open_case_per_profile_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_profile_id uuid;
    target_program_type text;
BEGIN
    IF NEW.archived_at IS NOT NULL OR NEW.status NOT IN ('open', 'needs_review')
       OR NEW.participation_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT participation.crm_profile_id, participation.program_type
      INTO target_profile_id, target_program_type
      FROM crm.program_participation AS participation
     WHERE participation.id = NEW.participation_id
       AND participation.archived_at IS NULL;

    IF target_profile_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'crm-open-case:' || target_profile_id::text || ':' || target_program_type,
            0
        )
    );

    IF EXISTS (
        SELECT 1
          FROM crm."case" AS existing_case
          JOIN crm.program_participation AS existing_participation
            ON existing_participation.id = existing_case.participation_id
         WHERE existing_case.id IS DISTINCT FROM NEW.id
           AND existing_case.archived_at IS NULL
           AND existing_case.status IN ('open', 'needs_review')
           AND existing_participation.archived_at IS NULL
           AND existing_participation.crm_profile_id = target_profile_id
           AND existing_participation.program_type = target_program_type
    ) THEN
        RAISE EXCEPTION 'an open case already exists for CRM profile and applicant route'
            USING ERRCODE = 'unique_violation',
                  CONSTRAINT = 'one_open_case_per_profile_route';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER one_open_case_per_profile_route_guard
BEFORE INSERT OR UPDATE OF participation_id, status, archived_at
ON crm."case"
FOR EACH ROW
EXECUTE FUNCTION crm.enforce_one_open_case_per_profile_route();
