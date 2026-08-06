-- Close two runtime invariants discovered by command-level verification:
-- active checklist positions must remain reusable after logical replacement,
-- and domain history/report snapshots must be append-only for runtime roles.

ALTER TABLE crm.task_checklist_item
    DROP CONSTRAINT IF EXISTS task_checklist_item_task_id_position_key;

CREATE UNIQUE INDEX task_checklist_active_position_uidx
    ON crm.task_checklist_item (task_id, position)
    WHERE archived_at IS NULL;

CREATE TRIGGER case_stage_history_append_only
BEFORE UPDATE OR DELETE ON crm.case_stage_history
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER employer_referral_stage_history_append_only
BEFORE UPDATE OR DELETE ON crm.employer_referral_stage_history
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER task_history_append_only
BEFORE UPDATE OR DELETE ON crm.task_history
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();

CREATE TRIGGER report_run_append_only
BEFORE UPDATE OR DELETE ON crm.report_run
FOR EACH ROW EXECUTE FUNCTION platform.reject_mutation();
