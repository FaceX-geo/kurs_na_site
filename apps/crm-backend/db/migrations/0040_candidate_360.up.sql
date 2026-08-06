INSERT INTO identity.permission (code, domain, description)
VALUES
    ('crm.candidate.duplicates.read', 'crm', 'Чтение доступной очереди возможных дублей кандидатов'),
    ('crm.candidate.merge', 'crm', 'Подтверждение обратимого объединения карточек кандидата'),
    ('crm.candidate.recommender.link', 'crm', 'Связывание кандидата с рекомендателем'),
    ('crm.candidate.document.review', 'crm', 'Проверка доступных документов кандидата')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('crm_project_manager', 'crm.candidate.duplicates.read'),
    ('crm_project_manager', 'crm.candidate.recommender.link'),
    ('crm_project_manager', 'crm.candidate.document.review'),
    ('crm_lead_specialist', 'crm.candidate.duplicates.read'),
    ('crm_lead_specialist', 'crm.candidate.merge'),
    ('crm_lead_specialist', 'crm.candidate.recommender.link'),
    ('crm_lead_specialist', 'crm.candidate.document.review'),
    ('crm_admin', 'crm.candidate.duplicates.read'),
    ('crm_admin', 'crm.candidate.merge'),
    ('crm_admin', 'crm.candidate.recommender.link'),
    ('crm_admin', 'crm.candidate.document.review'),
    ('crm_department_head', 'crm.candidate.duplicates.read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE TABLE crm.candidate_merge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    duplicate_candidate_id uuid NOT NULL REFERENCES crm.duplicate_candidate(id) ON DELETE RESTRICT,
    survivor_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    merged_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('active', 'reverted')),
    reviewed_by_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    merge_reason text NOT NULL CHECK (length(trim(merge_reason)) BETWEEN 8 AND 2000),
    merge_provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(merge_provenance) = 'object'),
    merged_at timestamptz NOT NULL,
    reverted_by_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    revert_reason text,
    revert_provenance jsonb CHECK (revert_provenance IS NULL OR jsonb_typeof(revert_provenance) = 'object'),
    reverted_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (survivor_person_id <> merged_person_id),
    CHECK (
        (state = 'active' AND reverted_by_user_account_id IS NULL AND revert_reason IS NULL AND reverted_at IS NULL)
        OR
        (state = 'reverted' AND reverted_by_user_account_id IS NOT NULL AND length(trim(revert_reason)) BETWEEN 8 AND 2000 AND reverted_at IS NOT NULL)
    )
);

COMMENT ON TABLE crm.candidate_merge IS
    'Reversible logical candidate merge. Identity rows are retained and are never rewritten by this aggregate.';

CREATE UNIQUE INDEX candidate_merge_active_duplicate_uidx
    ON crm.candidate_merge (duplicate_candidate_id)
    WHERE state = 'active';

CREATE UNIQUE INDEX candidate_merge_active_merged_person_uidx
    ON crm.candidate_merge (merged_person_id)
    WHERE state = 'active';

CREATE INDEX candidate_merge_survivor_idx
    ON crm.candidate_merge (survivor_person_id, merged_at DESC, id DESC)
    WHERE state = 'active';

CREATE FUNCTION crm.enforce_candidate_merge_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    locked_person_id uuid;
BEGIN
    IF NEW.state <> 'active' THEN
        RETURN NEW;
    END IF;

    FOR locked_person_id IN
        SELECT person_id
        FROM (VALUES (NEW.survivor_person_id), (NEW.merged_person_id)) AS participant(person_id)
        ORDER BY person_id
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(locked_person_id::text, 360));
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM identity.employee_profile employee
        WHERE employee.person_id IN (NEW.survivor_person_id, NEW.merged_person_id)
    ) THEN
        RAISE EXCEPTION 'employee identity cannot participate in candidate merge'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'candidate_merge_employee_identity_check';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM crm.duplicate_candidate duplicate
        WHERE duplicate.id = NEW.duplicate_candidate_id
          AND (
              (duplicate.left_person_id = NEW.survivor_person_id AND duplicate.right_person_id = NEW.merged_person_id)
              OR
              (duplicate.right_person_id = NEW.survivor_person_id AND duplicate.left_person_id = NEW.merged_person_id)
          )
    ) THEN
        RAISE EXCEPTION 'merge participants must match the duplicate candidate pair'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'candidate_merge_duplicate_pair_check';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM crm.candidate_merge existing
        WHERE existing.state = 'active'
          AND existing.id <> NEW.id
          AND (
              existing.merged_person_id IN (NEW.survivor_person_id, NEW.merged_person_id)
              OR existing.survivor_person_id = NEW.merged_person_id
          )
    ) THEN
        RAISE EXCEPTION 'active candidate merge chain is forbidden'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'candidate_merge_chain_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_candidate_merge_invariants
BEFORE INSERT OR UPDATE OF survivor_person_id, merged_person_id, state ON crm.candidate_merge
FOR EACH ROW EXECUTE FUNCTION crm.enforce_candidate_merge_invariants();

CREATE FUNCTION crm.enforce_employee_profile_candidate_merge_boundary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.person_id::text, 360));
    IF EXISTS (
        SELECT 1
        FROM crm.candidate_merge candidate_merge
        WHERE candidate_merge.state = 'active'
          AND NEW.person_id IN (candidate_merge.survivor_person_id, candidate_merge.merged_person_id)
    ) THEN
        RAISE EXCEPTION 'employee identity cannot be created for an actively merged candidate'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'employee_profile_candidate_merge_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_employee_profile_candidate_merge_boundary
BEFORE INSERT OR UPDATE OF person_id ON identity.employee_profile
FOR EACH ROW EXECUTE FUNCTION crm.enforce_employee_profile_candidate_merge_boundary();

CREATE TABLE crm.candidate_merge_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_merge_id uuid NOT NULL REFERENCES crm.candidate_merge(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN ('merged', 'reverted')),
    actor_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 2000),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (candidate_merge_id, aggregate_version)
);

CREATE INDEX candidate_merge_history_timeline_idx
    ON crm.candidate_merge_history (candidate_merge_id, occurred_at DESC, id DESC);

CREATE TRIGGER candidate_merge_history_append_only
BEFORE UPDATE OR DELETE ON crm.candidate_merge_history
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TABLE crm.candidate_recommender_link (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    recommender_person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    relationship_type text NOT NULL CHECK (relationship_type IN ('referrer', 'mentor', 'community_contact')),
    state text NOT NULL CHECK (state IN ('active', 'revoked')),
    linked_by_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    link_reason text NOT NULL CHECK (length(trim(link_reason)) BETWEEN 8 AND 2000),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    linked_at timestamptz NOT NULL,
    revoked_by_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    revoke_reason text,
    revoked_at timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (candidate_person_id <> recommender_person_id),
    CHECK (
        (state = 'active' AND revoked_by_user_account_id IS NULL AND revoke_reason IS NULL AND revoked_at IS NULL)
        OR
        (state = 'revoked' AND revoked_by_user_account_id IS NOT NULL AND length(trim(revoke_reason)) BETWEEN 8 AND 2000 AND revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX candidate_recommender_active_uidx
    ON crm.candidate_recommender_link (candidate_person_id, recommender_person_id, relationship_type)
    WHERE state = 'active';

CREATE INDEX candidate_recommender_candidate_idx
    ON crm.candidate_recommender_link (candidate_person_id, linked_at DESC, id DESC)
    WHERE state = 'active';

CREATE TABLE crm.candidate_recommender_link_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_recommender_link_id uuid NOT NULL REFERENCES crm.candidate_recommender_link(id) ON DELETE RESTRICT,
    event_type text NOT NULL CHECK (event_type IN ('linked', 'revoked')),
    actor_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 2000),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (candidate_recommender_link_id, aggregate_version)
);

CREATE INDEX candidate_recommender_history_timeline_idx
    ON crm.candidate_recommender_link_history (candidate_recommender_link_id, occurred_at DESC, id DESC);

CREATE TRIGGER candidate_recommender_link_history_append_only
BEFORE UPDATE OR DELETE ON crm.candidate_recommender_link_history
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TABLE crm.candidate_document (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id uuid NOT NULL REFERENCES identity.person(id) ON DELETE RESTRICT,
    case_id uuid REFERENCES crm."case"(id) ON DELETE RESTRICT,
    upload_id uuid REFERENCES intake.upload(id) ON DELETE RESTRICT,
    document_kind text NOT NULL CHECK (document_kind ~ '^[a-z][a-z0-9_]{1,95}$'),
    storage_reference text NOT NULL CHECK (length(trim(storage_reference)) BETWEEN 1 AND 1024),
    review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending', 'approved', 'rejected', 'needs_revision')),
    last_reviewed_by_user_account_id uuid REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    last_reviewed_at timestamptz,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK ((last_reviewed_by_user_account_id IS NULL) = (last_reviewed_at IS NULL))
);

CREATE UNIQUE INDEX candidate_document_storage_uidx
    ON crm.candidate_document (storage_reference)
    WHERE archived_at IS NULL;

CREATE INDEX candidate_document_review_queue_idx
    ON crm.candidate_document (review_state, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX candidate_document_person_idx
    ON crm.candidate_document (person_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE TABLE crm.candidate_document_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_document_id uuid NOT NULL REFERENCES crm.candidate_document(id) ON DELETE RESTRICT,
    from_state text NOT NULL CHECK (from_state IN ('pending', 'approved', 'rejected', 'needs_revision')),
    to_state text NOT NULL CHECK (to_state IN ('approved', 'rejected', 'needs_revision')),
    reviewer_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 2000),
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (from_state <> to_state),
    UNIQUE (candidate_document_id, aggregate_version)
);

CREATE INDEX candidate_document_review_timeline_idx
    ON crm.candidate_document_review (candidate_document_id, occurred_at DESC, id DESC);

CREATE TRIGGER candidate_document_review_append_only
BEFORE UPDATE OR DELETE ON crm.candidate_document_review
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER touch_candidate_merge
BEFORE UPDATE ON crm.candidate_merge
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TRIGGER touch_candidate_recommender_link
BEFORE UPDATE ON crm.candidate_recommender_link
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TRIGGER touch_candidate_document
BEFORE UPDATE ON crm.candidate_document
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();
