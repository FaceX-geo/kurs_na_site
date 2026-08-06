import type { MetricsSnapshot } from "./ports.js";

function metric(name: string, help: string, value: number): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${Math.max(0, Math.trunc(value))}`].join(
    "\n",
  );
}

/**
 * Metric names and labels are closed over code constants. Database values,
 * identifiers, source rows, reason text and secret-bearing configuration are
 * deliberately impossible to interpolate into this representation.
 */
export function renderPrometheusMetrics(snapshot: MetricsSnapshot): string {
  return [
    metric("crm_backend_up", "CRM backend process is serving requests", 1),
    metric(
      "crm_migration_runs_dry_running",
      "Migration runs currently in dry-run state",
      snapshot.migrationRuns.dryRunning,
    ),
    metric("crm_migration_runs_failed", "Migration runs in failed state", snapshot.migrationRuns.failed),
    metric(
      "crm_migration_runs_completed",
      "Migration runs in completed state",
      snapshot.migrationRuns.completed,
    ),
    metric(
      "crm_migration_conflicts_open_blocking",
      "Open blocking migration conflicts",
      snapshot.migrationConflicts.openBlocking,
    ),
    metric(
      "crm_migration_conflicts_open_warning",
      "Open warning migration conflicts",
      snapshot.migrationConflicts.openWarning,
    ),
    metric("crm_outbox_events_pending", "Outbox events waiting for delivery", snapshot.outbox.pending),
    metric("crm_outbox_events_retrying", "Outbox events with at least one retry", snapshot.outbox.retrying),
    metric("crm_audit_events_total", "Append-only audit events stored", snapshot.auditEvents),
  ]
    .join("\n\n")
    .concat("\n");
}
