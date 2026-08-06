export type {
  MysqlConnectionLike,
  MysqlLegacySourceOptions,
  MysqlPoolLike,
  MysqlQueryLike,
  PgPoolLike,
  PgQueryResultLike,
  PostgresMigrationUnitOfWorkOptions,
} from "./adapters/index.js";
export {
  CanonicalDryRunClassifier,
  MysqlLegacySource,
  PostgresMigrationUnitOfWork,
  SafeDryRunClassifier,
} from "./adapters/index.js";
export type { CanonicalTransformContract } from "./canonical-transform-registry.js";
export {
  CANONICAL_TRANSFORM_REGISTRY_VERSION,
  canonicalTransformContracts,
  getCanonicalTransformContract,
  getCanonicalTransformContractForSource,
} from "./canonical-transform-registry.js";
export { inspectLegacyDump } from "./dump-inspector.js";
export { MigrationError, toSafeMigrationError } from "./errors.js";
export { buildLedgerIdentity } from "./ledger-key.js";
export type { ExecuteMigrationInput } from "./orchestrator.js";
export { executeMigration } from "./orchestrator.js";
export { buildMigrationPlan, toSafeMigrationPlan } from "./plan.js";
export type {
  AtomicMigrationRequest,
  AtomicMigrationResult,
  LegacySourceIdentity,
  LegacySourcePort,
  MigrationClassifierPort,
  MigrationRunStart,
  MigrationUnitOfWorkPort,
} from "./ports.js";
export { runMigrationPreflight } from "./preflight.js";
export { loadMigrationRegistries } from "./registry-loader.js";
export type {
  LedgerOutcome,
  LegacyDumpInspection,
  LegacyRowEnvelope,
  LegacySourceKeyValue,
  MigrationDecision,
  MigrationIssue,
  MigrationLedgerRecord,
  MigrationManifest,
  MigrationManifestEntity,
  MigrationPlan,
  MigrationPlanItem,
  MigrationPreflightReport,
  MigrationProjection,
  MigrationRegistryBundle,
  MigrationRegistryQuery,
  MigrationRunMode,
  MigrationRunSummary,
  MigrationTargetAction,
  MigrationTargetIntent,
  SourceKeyDefinition,
  SourceTableDisposition,
} from "./types.js";
export {
  EXPECTED_SOURCE_SYSTEM,
  LEDGER_OUTCOMES,
  MIGRATION_PROJECTIONS,
  MIGRATION_TARGET_ACTIONS,
} from "./types.js";
