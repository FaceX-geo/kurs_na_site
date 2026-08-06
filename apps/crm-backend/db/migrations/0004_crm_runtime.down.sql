DROP INDEX IF EXISTS crm.activity_referral_timeline_idx;
DROP INDEX IF EXISTS crm.activity_employer_timeline_idx;
DROP INDEX IF EXISTS crm.activity_person_timeline_idx;
DROP INDEX IF EXISTS crm.crm_task_responsible_access_idx;
DROP INDEX IF EXISTS crm.crm_task_referral_access_idx;
DROP INDEX IF EXISTS crm.crm_task_case_access_idx;
DROP INDEX IF EXISTS crm.referral_owner_access_idx;
DROP INDEX IF EXISTS crm.referral_employer_access_idx;
DROP INDEX IF EXISTS crm.referral_person_access_idx;
DROP INDEX IF EXISTS crm.referral_case_access_idx;
DROP INDEX IF EXISTS crm.employer_registry_idx;
DROP INDEX IF EXISTS crm.program_participation_profile_idx;
DROP INDEX IF EXISTS crm.crm_profile_registry_idx;
DROP INDEX IF EXISTS crm.case_person_person_access_idx;
DROP INDEX IF EXISTS crm.case_assignment_employee_access_idx;
DROP INDEX IF EXISTS identity.employee_profile_org_access_idx;
DROP INDEX IF EXISTS identity.crm_role_assignment_lookup_idx;

DELETE FROM identity.role_permission
WHERE permission_code IN (
    'crm.case.read',
    'crm.case.list',
    'crm.case.transition',
    'crm.case.reopen',
    'crm.person.pii_view',
    'crm.employer.read',
    'crm.task.read',
    'crm.task.manage',
    'crm.communication.read'
);

DELETE FROM identity.permission
WHERE code IN (
    'crm.case.read',
    'crm.case.list',
    'crm.case.transition',
    'crm.case.reopen',
    'crm.person.pii_view',
    'crm.employer.read',
    'crm.task.read',
    'crm.task.manage',
    'crm.communication.read'
);
