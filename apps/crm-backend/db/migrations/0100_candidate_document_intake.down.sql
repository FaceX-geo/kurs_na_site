DROP INDEX IF EXISTS crm.candidate_document_case_idx;
DROP INDEX IF EXISTS crm.candidate_document_active_upload_uidx;

COMMENT ON COLUMN crm.candidate_document.storage_reference IS NULL;

DELETE FROM identity.role_permission
WHERE permission_code IN (
    'crm.candidate.document.read',
    'crm.candidate.document.download',
    'crm.candidate.recommender.read'
);

DELETE FROM identity.permission
WHERE code IN (
    'crm.candidate.document.read',
    'crm.candidate.document.download',
    'crm.candidate.recommender.read'
);
