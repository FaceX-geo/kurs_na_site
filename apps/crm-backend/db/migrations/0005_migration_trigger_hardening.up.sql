CREATE OR REPLACE FUNCTION migration.enforce_runtime_metadata_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ledger_key IS NOT NULL AND (NEW.source_key <> '{}'::jsonb OR NEW.evidence <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'runtime migration rows may persist digests and reason codes only'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.ledger_key IS NOT NULL AND NEW.reason_code !~ '^[A-Z0-9_]{1,128}$' THEN
        RAISE EXCEPTION 'runtime migration reason_code must be a stable non-sensitive code'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    -- migration.conflict deliberately has no outcome/target columns. Keep the
    -- ledger-only references inside a procedural branch so PostgreSQL never
    -- resolves them against the conflict row type.
    IF TG_TABLE_NAME = 'ledger' THEN
        IF EXISTS (SELECT 1 FROM migration.run WHERE id = NEW.run_id AND mode = 'dry-run')
           AND (
               NEW.outcome IN ('migrated', 'linked_existing')
               OR NEW.target_type IS NOT NULL
               OR NEW.target_id IS NOT NULL
           )
        THEN
            RAISE EXCEPTION 'dry-run ledger rows cannot claim a canonical target mutation'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
