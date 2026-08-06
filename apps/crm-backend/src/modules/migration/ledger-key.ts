import { createHash } from "node:crypto";
import { MigrationError } from "./errors.js";
import type { LegacyRowEnvelope, MigrationPlanItem } from "./types.js";

function canonicalJsonObject(value: Readonly<Record<string, boolean | number | string>>): string {
  const ordered = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
  return JSON.stringify(ordered);
}

export function buildLedgerIdentity(
  snapshotSha256: string,
  sourceSystem: string,
  item: MigrationPlanItem,
  row: LegacyRowEnvelope,
): Readonly<{ ledgerKey: string; sourceKeyDigest: string }> {
  const expectedColumns = [...item.sourceKey.columns].sort();
  const actualColumns = Object.keys(row.sourceKey).sort();
  if (
    expectedColumns.length !== actualColumns.length ||
    expectedColumns.some((column, index) => column !== actualColumns[index])
  ) {
    throw new MigrationError(
      "SOURCE_KEY_CONTRACT_VIOLATION",
      `Source adapter returned an invalid source key for table ${item.sourceTable}`,
    );
  }

  for (const value of Object.values(row.sourceKey)) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new MigrationError(
        "SOURCE_KEY_CONTRACT_VIOLATION",
        `Source adapter returned a non-safe numeric source key for table ${item.sourceTable}`,
      );
    }
  }

  const canonicalSourceKey = canonicalJsonObject(row.sourceKey);
  const sourceKeyDigest = createHash("sha256")
    .update(sourceSystem)
    .update("\u0000")
    .update(item.sourceTable)
    .update("\u0000")
    .update(canonicalSourceKey)
    .digest("hex");
  const ledgerKey = createHash("sha256")
    .update(snapshotSha256)
    .update("\u0000")
    .update(item.sourceTable)
    .update("\u0000")
    .update(canonicalSourceKey)
    .update("\u0000")
    .update(item.transformVersion)
    .digest("hex");

  return { ledgerKey, sourceKeyDigest };
}
