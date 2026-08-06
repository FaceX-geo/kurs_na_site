import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { MigrationError } from "./errors.js";
import type { LegacyDumpInspection } from "./types.js";

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  try {
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } catch (error) {
    throw new MigrationError("SOURCE_DUMP_UNREADABLE", `Legacy source dump is unreadable: ${path}`, {
      cause: error,
    });
  }
  return hash.digest("hex");
}

export async function inspectLegacyDump(dumpPath: string): Promise<LegacyDumpInspection> {
  let dumpStat: Stats;
  try {
    dumpStat = await stat(dumpPath);
  } catch (error) {
    throw new MigrationError("SOURCE_DUMP_UNREADABLE", `Legacy source dump is unreadable: ${dumpPath}`, {
      cause: error,
    });
  }

  if (!dumpStat.isFile()) {
    throw new MigrationError(
      "SOURCE_DUMP_UNREADABLE",
      `Legacy source dump is not a regular file: ${dumpPath}`,
    );
  }

  const sha256 = await sha256File(dumpPath);
  const source = createReadStream(dumpPath);
  const decoded = dumpPath.endsWith(".gz") ? source.pipe(createGunzip()) : source;
  const lines = createInterface({ input: decoded, crlfDelay: Number.POSITIVE_INFINITY });

  let changeMasterStatements = 0;
  let commitStatements = 0;
  let completedAt: string | null = null;
  let gtidMarkers = 0;
  let lockTableStatements = 0;
  let masterLogMarkers = 0;
  let startTransactionStatements = 0;
  let unlockTableStatements = 0;

  try {
    for await (const line of lines) {
      if (line.startsWith("START TRANSACTION")) {
        startTransactionStatements += 1;
      } else if (line.startsWith("COMMIT")) {
        commitStatements += 1;
      } else if (line.startsWith("LOCK TABLES ")) {
        lockTableStatements += 1;
      } else if (line.startsWith("UNLOCK TABLES")) {
        unlockTableStatements += 1;
      } else if (line.startsWith("CHANGE MASTER")) {
        changeMasterStatements += 1;
      } else if (line.startsWith("-- Dump completed on ")) {
        completedAt = line.slice("-- Dump completed on ".length).trim();
      }

      if (line.includes("GTID_PURGED")) {
        gtidMarkers += 1;
      }
      if (line.includes("MASTER_LOG_FILE")) {
        masterLogMarkers += 1;
      }
    }
  } catch (error) {
    throw new MigrationError(
      "SOURCE_DUMP_DECODE_FAILED",
      "Legacy source dump failed gzip or UTF-8 streaming validation",
      { cause: error },
    );
  }

  return {
    changeMasterStatements,
    commitStatements,
    completedAt,
    compressedBytes: dumpStat.size,
    dumpPath,
    gtidMarkers,
    lockTableStatements,
    masterLogMarkers,
    sha256,
    startTransactionStatements,
    unlockTableStatements,
  };
}
