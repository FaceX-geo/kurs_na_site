DROP TRIGGER IF EXISTS enforce_employee_profile_candidate_merge_boundary ON identity.employee_profile;
DROP FUNCTION IF EXISTS crm.enforce_employee_profile_candidate_merge_boundary();
DROP TRIGGER IF EXISTS enforce_candidate_merge_invariants ON crm.candidate_merge;
DROP FUNCTION IF EXISTS crm.enforce_candidate_merge_invariants();

DROP TABLE IF EXISTS crm.candidate_document_review;
DROP TABLE IF EXISTS crm.candidate_document;
DROP TABLE IF EXISTS crm.candidate_recommender_link_history;
DROP TABLE IF EXISTS crm.candidate_recommender_link;
DROP TABLE IF EXISTS crm.candidate_merge_history;
DROP TABLE IF EXISTS crm.candidate_merge;

DELETE FROM identity.role_permission
WHERE permission_code IN (
    'crm.candidate.duplicates.read',
    'crm.candidate.merge',
    'crm.candidate.recommender.link',
    'crm.candidate.document.review'
);

DELETE FROM identity.permission
WHERE code IN (
    'crm.candidate.duplicates.read',
    'crm.candidate.merge',
    'crm.candidate.recommender.link',
    'crm.candidate.document.review'
);
