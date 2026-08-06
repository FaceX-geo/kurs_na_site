import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertUploadLimitWithinStorageCeiling,
  UPLOAD_STORAGE_CEILING_BYTES,
} from "../src/common/upload-policy.js";
import { loadConfig } from "../src/config/env.js";
import { CandidateDocumentSchema } from "../src/modules/candidate360/contracts.js";
import type {
  Candidate360AuthorizationPort,
  Candidate360RepositoryPort,
} from "../src/modules/candidate360/ports.js";
import { createCandidate360Service } from "../src/modules/candidate360/service.js";
import { UploadReceiptSchema } from "../src/modules/intake/schemas.js";

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("upload storage ceiling contract", () => {
  it("allows lower runtime limits and rejects values above the durable ceiling", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        UPLOAD_MAX_BYTES: String(UPLOAD_STORAGE_CEILING_BYTES - 1),
      }).uploads.maxBytes,
    ).toBe(UPLOAD_STORAGE_CEILING_BYTES - 1);

    expect(() => assertUploadLimitWithinStorageCeiling(UPLOAD_STORAGE_CEILING_BYTES + 1)).toThrow(
      /no greater than/u,
    );
    expect(() =>
      createCandidate360Service({
        repository: {} as Candidate360RepositoryPort,
        authorization: {} as Candidate360AuthorizationPort,
        cursorSigningKey: "candidate-360-upload-policy-signing-key",
        maxDocumentContentBytes: UPLOAD_STORAGE_CEILING_BYTES + 1,
      }),
    ).toThrow(/no greater than/u);
  });

  it("keeps transport schemas on the same durable ceiling", () => {
    expect(UploadReceiptSchema.properties.size.maximum).toBe(UPLOAD_STORAGE_CEILING_BYTES);
    expect(CandidateDocumentSchema.properties.byteSize.anyOf[0].maximum).toBe(UPLOAD_STORAGE_CEILING_BYTES);
  });

  it("keeps the exported ceiling aligned with existing database constraints", async () => {
    const constraint = `byte_size > 0 AND byte_size <= ${UPLOAD_STORAGE_CEILING_BYTES}`;
    const migrations = await Promise.all(
      ["0001_core.up.sql", "0110_intake_identity_and_case_guards.up.sql"].map((fileName) =>
        readFile(path.join(applicationRoot, "db/migrations", fileName), "utf8"),
      ),
    );

    for (const migration of migrations) {
      expect(migration).toContain(constraint);
    }
  });
});
