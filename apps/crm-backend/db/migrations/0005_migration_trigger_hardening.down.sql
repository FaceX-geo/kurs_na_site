-- Keep the safe nested branch on rollback. Reintroducing the cross-table row
-- reference would make migration.conflict inserts fail at runtime.
SELECT 1;
