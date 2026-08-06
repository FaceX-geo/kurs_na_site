INSERT INTO identity.permission (code, domain, description)
VALUES
    ('crm.candidate.document.read', 'crm', 'Чтение метаданных документов доступного кандидата'),
    ('crm.candidate.document.download', 'crm', 'Скачивание проверенного документа доступного кандидата'),
    ('crm.candidate.recommender.read', 'crm', 'Чтение связей доступного кандидата с рекомендателями')
ON CONFLICT (code) DO UPDATE
SET domain = EXCLUDED.domain,
    description = EXCLUDED.description;

INSERT INTO identity.role_permission (role_code, permission_code)
VALUES
    ('crm_project_manager', 'crm.candidate.document.read'),
    ('crm_project_manager', 'crm.candidate.document.download'),
    ('crm_project_manager', 'crm.candidate.recommender.read'),
    ('crm_lead_specialist', 'crm.candidate.document.read'),
    ('crm_lead_specialist', 'crm.candidate.document.download'),
    ('crm_lead_specialist', 'crm.candidate.recommender.read'),
    ('crm_admin', 'crm.candidate.document.read'),
    ('crm_admin', 'crm.candidate.document.download'),
    ('crm_admin', 'crm.candidate.recommender.read'),
    ('crm_department_head', 'crm.candidate.document.read'),
    ('crm_department_head', 'crm.candidate.document.download'),
    ('crm_department_head', 'crm.candidate.recommender.read')
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- A public intake upload can produce at most one active CRM document. The routing worker and
-- inbox ledger remain idempotent; this index is the final database-level duplicate shield.
CREATE UNIQUE INDEX candidate_document_active_upload_uidx
    ON crm.candidate_document (upload_id)
    WHERE upload_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX candidate_document_case_idx
    ON crm.candidate_document (case_id, created_at DESC, id DESC)
    WHERE case_id IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN crm.candidate_document.storage_reference IS
    'Internal opaque source reference. API contracts must never expose this value or intake.upload.storage_key.';
