CREATE SCHEMA IF NOT EXISTS content;
REVOKE ALL ON SCHEMA content FROM PUBLIC;

CREATE TABLE content.vacancy (
    id uuid PRIMARY KEY,
    public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    document jsonb NOT NULL CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY[
            'sector', 'title', 'city', 'employer', 'salaryText', 'summary',
            'responsibilities', 'requirements', 'conditions', 'applicantType', 'sphere'
        ]
        AND jsonb_typeof(document->'responsibilities') = 'array'
        AND jsonb_typeof(document->'requirements') = 'array'
        AND jsonb_typeof(document->'conditions') = 'array'
        AND jsonb_typeof(document->'sector') = 'string'
        AND jsonb_typeof(document->'title') = 'string'
        AND jsonb_typeof(document->'city') = 'string'
        AND jsonb_typeof(document->'employer') = 'string'
        AND jsonb_typeof(document->'salaryText') = 'string'
        AND jsonb_typeof(document->'summary') = 'string'
        AND jsonb_typeof(document->'applicantType') = 'string'
        AND jsonb_typeof(document->'sphere') = 'string'
        AND document->>'sector' IN ('industry', 'medicine', 'education', 'port', 'safety', 'students')
        AND document->>'applicantType' IN ('relocation', 'student')
        AND jsonb_array_length(document->'responsibilities') > 0
        AND jsonb_array_length(document->'requirements') > 0
        AND jsonb_array_length(document->'conditions') > 0
        AND document - ARRAY[
            'sector', 'title', 'city', 'employer', 'salaryText', 'summary',
            'responsibilities', 'requirements', 'conditions', 'applicantType', 'sphere'
        ]::text[] = '{}'::jsonb
    ),
    publication_state text NOT NULL CHECK (publication_state IN ('draft', 'published', 'archived')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    published_at timestamptz,
    created_by uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    updated_by uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (
        (publication_state = 'draft' AND published_at IS NULL AND archived_at IS NULL)
        OR (publication_state = 'published' AND published_at IS NOT NULL AND archived_at IS NULL)
        OR (publication_state = 'archived' AND archived_at IS NOT NULL)
    )
);

CREATE TABLE content.story (
    id uuid PRIMARY KEY,
    public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    document jsonb NOT NULL CHECK (
        jsonb_typeof(document) = 'object'
        AND document ?& ARRAY[
            'tone', 'filters', 'cardTags', 'ariaLabel', 'eyebrow', 'title', 'person',
            'route', 'avatar', 'avatarAlt', 'cardQuote', 'quote', 'tags', 'lead', 'gallery', 'steps'
        ]
        AND jsonb_typeof(document->'filters') = 'array'
        AND jsonb_typeof(document->'cardTags') = 'array'
        AND jsonb_typeof(document->'tags') = 'array'
        AND jsonb_typeof(document->'gallery') = 'array'
        AND jsonb_typeof(document->'steps') = 'array'
        AND jsonb_typeof(document->'tone') = 'string'
        AND jsonb_typeof(document->'ariaLabel') = 'string'
        AND jsonb_typeof(document->'eyebrow') = 'string'
        AND jsonb_typeof(document->'title') = 'string'
        AND jsonb_typeof(document->'person') = 'string'
        AND jsonb_typeof(document->'route') = 'string'
        AND jsonb_typeof(document->'avatar') = 'string'
        AND jsonb_typeof(document->'avatarAlt') = 'string'
        AND jsonb_typeof(document->'cardQuote') = 'string'
        AND jsonb_typeof(document->'quote') = 'string'
        AND jsonb_typeof(document->'lead') = 'string'
        AND document->>'tone' IN ('berry', 'cyan', 'blue')
        AND jsonb_array_length(document->'steps') > 0
        AND document - ARRAY[
            'tone', 'filters', 'cardTags', 'ariaLabel', 'eyebrow', 'title', 'person',
            'route', 'avatar', 'avatarAlt', 'cardQuote', 'quote', 'tags', 'lead', 'gallery', 'steps'
        ]::text[] = '{}'::jsonb
    ),
    publication_state text NOT NULL CHECK (publication_state IN ('draft', 'published', 'archived')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    published_at timestamptz,
    created_by uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    updated_by uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz,
    CHECK (
        (publication_state = 'draft' AND published_at IS NULL AND archived_at IS NULL)
        OR (publication_state = 'published' AND published_at IS NOT NULL AND archived_at IS NULL)
        OR (publication_state = 'archived' AND archived_at IS NOT NULL)
    )
);

CREATE TABLE content.revision (
    id uuid PRIMARY KEY,
    entity_type text NOT NULL CHECK (entity_type IN ('vacancy', 'story')),
    entity_id uuid NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    publication_state text NOT NULL CHECK (publication_state IN ('draft', 'published', 'archived')),
    actor_user_account_id uuid NOT NULL REFERENCES identity.user_account(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 4000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (entity_type, entity_id, version)
);

CREATE FUNCTION content.enforce_revision_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    parent_matches boolean;
BEGIN
    IF NEW.entity_type = 'vacancy' THEN
        SELECT EXISTS (
            SELECT 1
            FROM content.vacancy AS parent
            WHERE parent.id = NEW.entity_id
              AND parent.version = NEW.version
              AND parent.document = NEW.document
              AND parent.publication_state = NEW.publication_state
        ) INTO parent_matches;
    ELSIF NEW.entity_type = 'story' THEN
        SELECT EXISTS (
            SELECT 1
            FROM content.story AS parent
            WHERE parent.id = NEW.entity_id
              AND parent.version = NEW.version
              AND parent.document = NEW.document
              AND parent.publication_state = NEW.publication_state
        ) INTO parent_matches;
    ELSE
        parent_matches := false;
    END IF;

    IF NOT parent_matches THEN
        RAISE EXCEPTION 'content revision does not match its current parent version'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION content.enforce_revision_parent() FROM PUBLIC;

REVOKE ALL ON TABLE content.vacancy, content.story, content.revision FROM PUBLIC;

CREATE TRIGGER touch_public_content_vacancy
BEFORE UPDATE ON content.vacancy
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TRIGGER touch_public_content_story
BEFORE UPDATE ON content.story
FOR EACH ROW EXECUTE FUNCTION platform.touch_versioned_row();

CREATE TRIGGER reject_public_content_revision_mutation
BEFORE UPDATE OR DELETE ON content.revision
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER enforce_public_content_revision_parent
BEFORE INSERT ON content.revision
FOR EACH ROW EXECUTE FUNCTION content.enforce_revision_parent();

CREATE INDEX content_vacancy_publication_idx
    ON content.vacancy (publication_state, created_at DESC, id DESC)
    WHERE archived_at IS NULL;
CREATE INDEX content_story_publication_idx
    ON content.story (publication_state, created_at DESC, id DESC)
    WHERE archived_at IS NULL;
CREATE INDEX content_revision_timeline_idx
    ON content.revision (entity_type, entity_id, version DESC);

INSERT INTO identity.permission (code, domain, description)
VALUES
    ('content.vacancy.read', 'platform', 'Чтение реестра вакансий лендинга'),
    ('content.vacancy.manage', 'platform', 'Создание, изменение, публикация и архивирование вакансий'),
    ('content.story.read', 'platform', 'Чтение реестра историй лендинга'),
    ('content.story.manage', 'platform', 'Создание, изменение, публикация и архивирование историй')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('platform_superadmin', 'content.vacancy.read'),
    ('platform_superadmin', 'content.vacancy.manage'),
    ('platform_superadmin', 'content.story.read'),
    ('platform_superadmin', 'content.story.manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') THEN
        GRANT USAGE ON SCHEMA content TO kurs_crm_api;
        GRANT SELECT, INSERT, UPDATE ON content.vacancy TO kurs_crm_api;
        GRANT SELECT, INSERT, UPDATE ON content.story TO kurs_crm_api;
        GRANT SELECT, INSERT ON content.revision TO kurs_crm_api;
        GRANT EXECUTE ON FUNCTION content.enforce_revision_parent() TO kurs_crm_api;
    END IF;
END
$$;
