import { describe, expect, it } from "vitest";
import {
  canonicalTransformContracts,
  getCanonicalTransformContract,
  type MigrationProjection,
} from "../src/modules/migration/index.js";

function classify(sourceTable: string, transformVersion: string, payload: Readonly<Record<string, unknown>>) {
  const contract = getCanonicalTransformContract(sourceTable, transformVersion);
  if (contract === undefined) {
    throw new Error(`missing canonical transform contract for ${sourceTable}:${transformVersion}`);
  }
  return contract.classify(payload);
}

describe("canonical migration transform registry", () => {
  it("keeps the seven audited transforms ordered, dependency-aware, and count-balanced", () => {
    const contracts = canonicalTransformContracts();
    const totals: Record<MigrationProjection, number> = {
      would_conflict: 0,
      would_exclude: 0,
      would_migrate: 0,
      would_quarantine: 0,
    };

    for (const contract of contracts) {
      for (const [projection, count] of Object.entries(contract.expectedProjectionCounts)) {
        totals[projection as MigrationProjection] += count;
      }
    }

    expect(contracts.map((contract) => contract.sourceTable)).toEqual([
      "b_user",
      "b_crm_contact",
      "b_crm_company",
      "b_crm_field_multi",
      "b_crm_requisite",
      "b_crm_deal",
      "b_tasks",
    ]);
    expect(contracts.map((contract) => contract.executionOrder)).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(totals).toEqual({
      would_conflict: 2202,
      would_exclude: 627,
      would_migrate: 8732,
      would_quarantine: 2807,
    });
  });

  it.each([
    [
      "b_user",
      "actor-v2",
      { HAS_DEPARTMENT_LINK: 0, ID: 1, LAST_NAME: "", NAME: "" },
      "would_migrate",
      "DRY_RUN_WOULD_MIGRATE",
    ],
    [
      "b_user",
      "actor-v2",
      { HAS_DEPARTMENT_LINK: 1, ID: 2, LAST_NAME: "", NAME: "Structured" },
      "would_conflict",
      "EMPLOYEE_STRUCTURED_NAME_REQUIRED",
    ],
    [
      "b_crm_contact",
      "crm-person-v2",
      { FULL_NAME: "Evidence", ID: 3, LAST_NAME: "Name", NAME: "Given", OWNER_EXISTS: 1, OWNER_IS_ACTIVE: 1 },
      "would_migrate",
      "DRY_RUN_WOULD_MIGRATE",
    ],
    [
      "b_crm_contact",
      "crm-person-v2",
      { FULL_NAME: "Evidence", ID: 4, LAST_NAME: "Name", NAME: "Given", OWNER_EXISTS: 1, OWNER_IS_ACTIVE: 0 },
      "would_quarantine",
      "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT",
    ],
    [
      "b_crm_company",
      "employer-v2",
      { ID: 5, OWNER_EXISTS: 1, OWNER_IS_ACTIVE: 1, TITLE: "Employer" },
      "would_migrate",
      "DRY_RUN_WOULD_MIGRATE",
    ],
    [
      "b_crm_field_multi",
      "contact-point-v2",
      {
        ID: 6,
        IS_SUPPORTED_CONTACT_POINT: 0,
        NORMALIZED_DUPLICATE_COUNT: 0,
        PARENT_EXISTS: 0,
        PARENT_IS_READY: 0,
      },
      "would_exclude",
      "CONTACT_POINT_KIND_OUTSIDE_CANONICAL_SCOPE",
    ],
    [
      "b_crm_field_multi",
      "contact-point-v2",
      {
        ID: 7,
        IS_SUPPORTED_CONTACT_POINT: 1,
        NORMALIZED_DUPLICATE_COUNT: 2,
        PARENT_EXISTS: 1,
        PARENT_IS_READY: 1,
      },
      "would_conflict",
      "CONTACT_POINT_DUPLICATE_REQUIRES_REVIEW",
    ],
    [
      "b_crm_requisite",
      "employer-requisite-v2",
      {
        ID: 8,
        IS_COMPANY_REQUISITE: 1,
        NORMALIZED_TAX_ID_DUPLICATE_COUNT: 0,
        PARENT_EXISTS: 1,
        PARENT_IS_READY: 0,
      },
      "would_quarantine",
      "EMPLOYER_REQUISITE_PARENT_NOT_READY",
    ],
    [
      "b_crm_deal",
      "crm-case-v2",
      {
        CATEGORY_ID: 2,
        COMPANY_REFERENCE_IS_READY: 1,
        CONTACT_EXISTS: 1,
        CONTACT_IS_READY: 1,
        ID: 9,
        OWNER_EXISTS: 1,
        OWNER_IS_ACTIVE: 1,
        TITLE: "Case",
      },
      "would_migrate",
      "DRY_RUN_WOULD_MIGRATE",
    ],
    [
      "b_tasks",
      "legacy-task-v2",
      {
        CRM_DOMAIN_EVIDENCE: 1,
        ID: 10,
        PROJECT_DOMAIN_EVIDENCE: 1,
        RESPONSIBLE_EXISTS: 1,
        RESPONSIBLE_IS_ACTIVE: 1,
      },
      "would_conflict",
      "TASK_DOMAIN_DUAL_USE_REQUIRES_DECISION",
    ],
  ] as const)(
    "classifies %s:%s as %s",
    (sourceTable, transformVersion, payload, expectedProjection, expectedReasonCode) => {
      const decision = classify(sourceTable, transformVersion, payload);

      expect(decision.projection).toBe(expectedProjection);
      expect(decision.reasonCode).toBe(expectedReasonCode);
      expect(decision.targetIntents.every((intent) => intent.targetId === undefined)).toBe(true);
    },
  );

  it("does not infer a transform from a source table when the version is unknown", () => {
    expect(getCanonicalTransformContract("b_crm_contact", "crm-person-v999")).toBeUndefined();
  });
});
