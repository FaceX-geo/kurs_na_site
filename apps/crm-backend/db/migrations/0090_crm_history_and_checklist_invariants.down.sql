DROP TRIGGER IF EXISTS report_run_append_only ON crm.report_run;
DROP TRIGGER IF EXISTS task_history_append_only ON crm.task_history;
DROP TRIGGER IF EXISTS employer_referral_stage_history_append_only ON crm.employer_referral_stage_history;
DROP TRIGGER IF EXISTS case_stage_history_append_only ON crm.case_stage_history;

DROP INDEX IF EXISTS crm.task_checklist_active_position_uidx;

-- This intentionally fails closed if newer data contains archived checklist
-- positions that cannot satisfy the former all-row uniqueness constraint.
ALTER TABLE crm.task_checklist_item
    ADD CONSTRAINT task_checklist_item_task_id_position_key UNIQUE (task_id, position);
