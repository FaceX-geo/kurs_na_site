DELETE FROM identity.role_permission
WHERE permission_code IN (
    'crm.case.update',
    'crm.employer.manage',
    'crm.referral.manage',
    'crm.communication.manage',
    'crm.dashboard.read',
    'crm.notification.read',
    'crm.report.build',
    'crm.report.export',
    'crm.settings.manage'
);
DELETE FROM identity.permission
WHERE code IN (
    'crm.case.update',
    'crm.employer.manage',
    'crm.referral.manage',
    'crm.communication.manage',
    'crm.dashboard.read',
    'crm.notification.read',
    'crm.report.build',
    'crm.report.export',
    'crm.settings.manage'
);

DROP TABLE IF EXISTS crm.setting_version;
DROP TABLE IF EXISTS crm.report_run;
DROP TABLE IF EXISTS crm.notification;
DROP TABLE IF EXISTS crm.communication_recipient;
DROP TABLE IF EXISTS crm.communication_draft;
DROP TABLE IF EXISTS crm.task_history;
DROP TABLE IF EXISTS crm.task_comment;
DROP TABLE IF EXISTS crm.task_checklist_item;
DROP TABLE IF EXISTS crm.task_participant;
DROP TABLE IF EXISTS crm.employer_referral_stage_history;
DROP TABLE IF EXISTS crm.employer_assignment;

ALTER TABLE crm.task
    DROP COLUMN IF EXISTS creator_user_account_id,
    DROP COLUMN IF EXISTS timezone,
    DROP COLUMN IF EXISTS priority;
ALTER TABLE crm.relocation_profile
    DROP COLUMN IF EXISTS result_reason,
    DROP COLUMN IF EXISTS result_code,
    DROP COLUMN IF EXISTS support_measures,
    DROP COLUMN IF EXISTS employment_status,
    DROP COLUMN IF EXISTS offer_status;
ALTER TABLE crm.employer_referral
    DROP COLUMN IF EXISTS comment;
ALTER TABLE crm.employer
    DROP COLUMN IF EXISTS manual_review_reason,
    DROP COLUMN IF EXISTS organization_type;
ALTER TABLE crm."case"
    DROP COLUMN IF EXISTS attributes;
