DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kurs_crm_api') THEN
        REVOKE ALL ON FUNCTION content.enforce_revision_parent() FROM kurs_crm_api;
        REVOKE ALL ON content.revision FROM kurs_crm_api;
        REVOKE ALL ON content.story FROM kurs_crm_api;
        REVOKE ALL ON content.vacancy FROM kurs_crm_api;
        REVOKE USAGE ON SCHEMA content FROM kurs_crm_api;
    END IF;
END
$$;

DELETE FROM identity.role_permission
WHERE role_code = 'platform_superadmin'
  AND permission_code IN (
      'content.vacancy.read', 'content.vacancy.manage',
      'content.story.read', 'content.story.manage'
  );

DELETE FROM identity.permission
WHERE code IN (
    'content.vacancy.read', 'content.vacancy.manage',
    'content.story.read', 'content.story.manage'
);

DROP TABLE content.revision;
DROP TABLE content.story;
DROP TABLE content.vacancy;
DROP FUNCTION content.enforce_revision_parent();
DROP SCHEMA content;
