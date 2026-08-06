DROP TRIGGER IF EXISTS one_open_case_per_profile_route_guard ON crm."case";
DROP FUNCTION IF EXISTS crm.enforce_one_open_case_per_profile_route();
DROP FUNCTION IF EXISTS identity.person_has_employee_profile(uuid);
DROP FUNCTION IF EXISTS identity.person_has_user_account(uuid);
DROP TRIGGER IF EXISTS require_binding_for_new_upload_guard ON intake.upload;
DROP FUNCTION IF EXISTS intake.require_binding_for_new_upload();
DROP TABLE IF EXISTS intake.upload_reservation;

ALTER TABLE intake.upload
    DROP CONSTRAINT IF EXISTS upload_binding_consumption_check,
    DROP CONSTRAINT IF EXISTS upload_binding_columns_check,
    DROP COLUMN IF EXISTS binding_consumed_at,
    DROP COLUMN IF EXISTS binding_key_version,
    DROP COLUMN IF EXISTS binding_token_hash;
