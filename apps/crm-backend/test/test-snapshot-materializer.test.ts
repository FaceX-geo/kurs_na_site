import { describe, expect, it } from "vitest";
import {
  JULY_22_TEST_SNAPSHOT_CONFIRMATION,
  JULY_22_TEST_SNAPSHOT_SHA256,
  normalizeLegacyPhone,
  readTestSnapshotMaterializationConfig,
  stableLegacyUuid,
} from "../src/modules/migration/test-snapshot-materializer.js";

const validEnvironment = {
  CRM_TEST_SNAPSHOT_IMPORT: "true",
  CRM_TEST_SNAPSHOT_IMPORT_CONFIRM: JULY_22_TEST_SNAPSHOT_CONFIRMATION,
  CRM_TEST_SNAPSHOT_SHA256: JULY_22_TEST_SNAPSHOT_SHA256,
  DATABASE_URL: "postgresql://migrator:secret@postgres:5432/kurs_crm",
  LEGACY_MYSQL_URL: "mysql://reader:secret@legacy-mysql:3306/sitemanager",
};

describe("July 22 test snapshot materializer", () => {
  it("requires an explicit test-only confirmation gate", () => {
    expect(() =>
      readTestSnapshotMaterializationConfig({ ...validEnvironment, CRM_TEST_SNAPSHOT_IMPORT: "false" }),
    ).toThrowError(/CRM_TEST_SNAPSHOT_IMPORT=true/u);
    expect(() =>
      readTestSnapshotMaterializationConfig({
        ...validEnvironment,
        CRM_TEST_SNAPSHOT_IMPORT_CONFIRM: "RESTORE_PRODUCTION",
      }),
    ).toThrowError(/exact July 22 confirmation phrase/u);
  });

  it("pins the exact audited snapshot identity", () => {
    expect(() =>
      readTestSnapshotMaterializationConfig({
        ...validEnvironment,
        CRM_TEST_SNAPSHOT_SHA256: "0".repeat(64),
      }),
    ).toThrowError(/differs from the pinned July 22 source/u);
    expect(readTestSnapshotMaterializationConfig(validEnvironment).snapshotSha256).toBe(
      JULY_22_TEST_SNAPSHOT_SHA256,
    );
  });

  it("produces deterministic UUIDs per source identity", () => {
    const first = stableLegacyUuid("b_crm_contact.person", 42);
    expect(first).toBe(stableLegacyUuid("b_crm_contact.person", 42));
    expect(first).not.toBe(stableLegacyUuid("b_crm_contact.profile", 42));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("normalizes only E.164-compatible legacy phones", () => {
    expect(normalizeLegacyPhone("8 (921) 555-12-34")).toBe("+79215551234");
    expect(normalizeLegacyPhone("921 555 12 34")).toBe("+79215551234");
    expect(normalizeLegacyPhone("123")).toBeNull();
  });
});
