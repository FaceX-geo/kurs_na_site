import { classifyWithCanonicalTransform } from "../canonical-transform-registry.js";
import { MigrationError } from "../errors.js";
import type { MigrationClassifierPort } from "../ports.js";
import type { LegacyRowEnvelope, MigrationDecision, MigrationPlanItem } from "../types.js";

/**
 * Dry-run projects registered source rows into privacy-safe target intents. It never
 * mutates or claims to have created a canonical target. Unregistered transforms stay
 * fail-closed in quarantine.
 */
export class SafeDryRunClassifier implements MigrationClassifierPort {
  public async classify(
    item: MigrationPlanItem,
    row: LegacyRowEnvelope,
    signal?: AbortSignal,
  ): Promise<MigrationDecision> {
    if (signal?.aborted) {
      throw new MigrationError("MIGRATION_ABORTED", "Migration was aborted safely");
    }

    return classifyWithCanonicalTransform(item, row);
  }
}

export class CanonicalDryRunClassifier extends SafeDryRunClassifier {}
