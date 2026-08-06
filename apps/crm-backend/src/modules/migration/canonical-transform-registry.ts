import { MigrationError } from "./errors.js";
import type {
  LegacyRowEnvelope,
  MigrationDecision,
  MigrationPlanItem,
  MigrationProjection,
  MigrationTargetAction,
  MigrationTargetIntent,
} from "./types.js";

export const CANONICAL_TRANSFORM_REGISTRY_VERSION = "canonical-transform-registry-v1" as const;

export interface CanonicalTransformContract {
  readonly classifierId: string;
  readonly dependsOn: readonly string[];
  readonly executionOrder: number;
  readonly expectedProjectionCounts: Readonly<Record<MigrationProjection, number>>;
  readonly requiredColumns: readonly string[];
  readonly sourceTable: string;
  readonly transformVersion: string;
  readonly validationRules: readonly string[];
  classify(payload: Readonly<Record<string, unknown>>): MigrationDecision;
}

const outcomeByProjection = {
  would_conflict: "conflict_recorded",
  would_exclude: "excluded_with_reason",
  would_migrate: "quarantined",
  would_quarantine: "quarantined",
} as const;

function target(
  targetEntity: string,
  projection: MigrationProjection,
  reasonCode?: string,
  action: MigrationTargetAction = "create",
): MigrationTargetIntent {
  return {
    action,
    projection,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    targetEntity,
  };
}

function decision(
  projection: MigrationProjection,
  reasonCode: string,
  targetIntents: readonly MigrationTargetIntent[],
): MigrationDecision {
  return {
    outcome: outcomeByProjection[projection],
    projection,
    reasonCode,
    targetIntents,
  };
}

function asFlag(payload: Readonly<Record<string, unknown>>, column: string): boolean {
  const value = payload[column];
  if (value === true || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === "0") {
    return false;
  }
  throw new MigrationError(
    "CANONICAL_TRANSFORM_INPUT_INVALID",
    `Canonical transform received an invalid boolean classifier column: ${column}`,
  );
}

function asInteger(payload: Readonly<Record<string, unknown>>, column: string): number {
  const value = payload[column];
  const normalized = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(normalized)) {
    throw new MigrationError(
      "CANONICAL_TRANSFORM_INPUT_INVALID",
      `Canonical transform received an invalid integer classifier column: ${column}`,
    );
  }
  return normalized;
}

function isNonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function classifierTargets(
  targets: readonly string[],
  projection: MigrationProjection,
  reasonCode: string,
  action: MigrationTargetAction = "create",
): readonly MigrationTargetIntent[] {
  return targets.map((targetEntity) => target(targetEntity, projection, reasonCode, action));
}

const contracts: readonly CanonicalTransformContract[] = [
  {
    classifierId: "legacy-actor-safe-v2",
    dependsOn: [],
    executionOrder: 10,
    expectedProjectionCounts: {
      would_conflict: 1,
      would_exclude: 0,
      would_migrate: 217,
      would_quarantine: 0,
    },
    requiredColumns: ["ID", "HAS_DEPARTMENT_LINK", "NAME", "LAST_NAME"],
    sourceTable: "b_user",
    transformVersion: "actor-v2",
    validationRules: [
      "all source users retain a migration.legacy_actor intent",
      "department-linked employee targets require structured names",
      "legacy credentials and roles are never transformed",
    ],
    classify(payload) {
      const actorIntent = target("migration.legacy_actor", "would_migrate");
      if (!asFlag(payload, "HAS_DEPARTMENT_LINK")) {
        return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [actorIntent]);
      }
      if (!isNonBlank(payload.NAME) || !isNonBlank(payload.LAST_NAME)) {
        const reasonCode = "EMPLOYEE_STRUCTURED_NAME_REQUIRED";
        return decision("would_conflict", reasonCode, [
          actorIntent,
          target("identity.person", "would_conflict", reasonCode),
          target("identity.employee_profile", "would_conflict", reasonCode),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        actorIntent,
        target("identity.person", "would_migrate"),
        target("identity.employee_profile", "would_migrate"),
      ]);
    },
  },
  {
    classifierId: "crm-contact-safe-v2",
    dependsOn: ["b_user"],
    executionOrder: 20,
    expectedProjectionCounts: {
      would_conflict: 640,
      would_exclude: 0,
      would_migrate: 2088,
      would_quarantine: 458,
    },
    requiredColumns: ["ID", "OWNER_EXISTS", "OWNER_IS_ACTIVE", "NAME", "LAST_NAME", "FULL_NAME"],
    sourceTable: "b_crm_contact",
    transformVersion: "crm-person-v2",
    validationRules: [
      "owner source user exists",
      "inactive operational owner requires a signed reassignment",
      "given name and surname are structured source fields; FULL_NAME is evidence only",
      "employee and candidate identities are never auto-merged",
    ],
    classify(payload) {
      const baseTargets = ["identity.person", "crm.crm_profile"] as const;
      if (!asFlag(payload, "OWNER_EXISTS")) {
        const reasonCode = "CONTACT_OWNER_ACTOR_MISSING";
        return decision(
          "would_conflict",
          reasonCode,
          classifierTargets([...baseTargets, "crm.crm_profile_assignment"], "would_conflict", reasonCode),
        );
      }
      if (!isNonBlank(payload.NAME) || !isNonBlank(payload.LAST_NAME)) {
        const reasonCode = "CONTACT_STRUCTURED_NAME_REQUIRED";
        return decision(
          "would_conflict",
          reasonCode,
          classifierTargets([...baseTargets, "crm.crm_profile_assignment"], "would_conflict", reasonCode),
        );
      }
      if (!asFlag(payload, "OWNER_IS_ACTIVE")) {
        const reasonCode = "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT";
        return decision("would_quarantine", reasonCode, [
          ...classifierTargets(baseTargets, "would_migrate", "DRY_RUN_WOULD_MIGRATE"),
          target("crm.crm_profile_assignment", "would_quarantine", reasonCode, "link"),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        ...classifierTargets(baseTargets, "would_migrate", "DRY_RUN_WOULD_MIGRATE"),
        target("crm.crm_profile_assignment", "would_migrate", undefined, "link"),
      ]);
    },
  },
  {
    classifierId: "crm-company-safe-v2",
    dependsOn: ["b_user"],
    executionOrder: 30,
    expectedProjectionCounts: {
      would_conflict: 0,
      would_exclude: 0,
      would_migrate: 709,
      would_quarantine: 88,
    },
    requiredColumns: ["ID", "OWNER_EXISTS", "OWNER_IS_ACTIVE", "TITLE"],
    sourceTable: "b_crm_company",
    transformVersion: "employer-v2",
    validationRules: [
      "company title is present",
      "owner source user exists",
      "inactive operational owner requires a signed reassignment",
    ],
    classify(payload) {
      if (!isNonBlank(payload.TITLE)) {
        const reasonCode = "COMPANY_TITLE_REQUIRED";
        return decision(
          "would_conflict",
          reasonCode,
          classifierTargets(["crm.employer", "crm.employer_assignment"], "would_conflict", reasonCode),
        );
      }
      if (!asFlag(payload, "OWNER_EXISTS")) {
        const reasonCode = "COMPANY_OWNER_ACTOR_MISSING";
        return decision(
          "would_conflict",
          reasonCode,
          classifierTargets(["crm.employer", "crm.employer_assignment"], "would_conflict", reasonCode),
        );
      }
      if (!asFlag(payload, "OWNER_IS_ACTIVE")) {
        const reasonCode = "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT";
        return decision("would_quarantine", reasonCode, [
          target("crm.employer", "would_migrate"),
          target("crm.employer_assignment", "would_quarantine", reasonCode, "link"),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        target("crm.employer", "would_migrate"),
        target("crm.employer_assignment", "would_migrate", undefined, "link"),
      ]);
    },
  },
  {
    classifierId: "crm-contact-point-safe-v2",
    dependsOn: ["b_crm_contact", "b_crm_company"],
    executionOrder: 40,
    expectedProjectionCounts: {
      would_conflict: 952,
      would_exclude: 621,
      would_migrate: 4089,
      would_quarantine: 2091,
    },
    requiredColumns: [
      "ID",
      "IS_SUPPORTED_CONTACT_POINT",
      "PARENT_EXISTS",
      "PARENT_IS_READY",
      "NORMALIZED_DUPLICATE_COUNT",
    ],
    sourceTable: "b_crm_field_multi",
    transformVersion: "contact-point-v2",
    validationRules: [
      "only CONTACT or COMPANY EMAIL and PHONE rows are canonical contact points",
      "parent row must have a would_migrate base-entity intent",
      "normalization duplicates are conflict signals and never automatic merges",
      "raw values are never persisted in migration ledgers",
    ],
    classify(payload) {
      if (!asFlag(payload, "IS_SUPPORTED_CONTACT_POINT")) {
        return decision("would_exclude", "CONTACT_POINT_KIND_OUTSIDE_CANONICAL_SCOPE", []);
      }
      if (!asFlag(payload, "PARENT_EXISTS")) {
        const reasonCode = "CONTACT_POINT_PARENT_MISSING";
        return decision("would_conflict", reasonCode, [
          target("crm.contact_point", "would_conflict", reasonCode),
        ]);
      }
      if (!asFlag(payload, "PARENT_IS_READY")) {
        const reasonCode = "CONTACT_POINT_PARENT_NOT_READY";
        return decision("would_quarantine", reasonCode, [
          target("crm.contact_point", "would_quarantine", reasonCode),
        ]);
      }
      if (asInteger(payload, "NORMALIZED_DUPLICATE_COUNT") > 1) {
        const reasonCode = "CONTACT_POINT_DUPLICATE_REQUIRES_REVIEW";
        return decision("would_conflict", reasonCode, [
          target("crm.contact_point", "would_conflict", reasonCode),
          target("migration.duplicate_signal", "would_migrate"),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        target("crm.contact_point", "would_migrate"),
      ]);
    },
  },
  {
    classifierId: "crm-employer-requisite-safe-v2",
    dependsOn: ["b_crm_company"],
    executionOrder: 50,
    expectedProjectionCounts: {
      would_conflict: 43,
      would_exclude: 6,
      would_migrate: 331,
      would_quarantine: 46,
    },
    requiredColumns: [
      "ID",
      "IS_COMPANY_REQUISITE",
      "PARENT_EXISTS",
      "PARENT_IS_READY",
      "NORMALIZED_TAX_ID_DUPLICATE_COUNT",
    ],
    sourceTable: "b_crm_requisite",
    transformVersion: "employer-requisite-v2",
    validationRules: [
      "only ENTITY_TYPE_ID=4 is a company requisite",
      "parent employer must have a would_migrate base-entity intent",
      "duplicate normalized tax identifiers require signed resolution",
    ],
    classify(payload) {
      if (!asFlag(payload, "IS_COMPANY_REQUISITE")) {
        return decision("would_exclude", "REQUISITE_ENTITY_TYPE_OUTSIDE_COMPANY_SCOPE", []);
      }
      if (!asFlag(payload, "PARENT_EXISTS")) {
        const reasonCode = "EMPLOYER_REQUISITE_PARENT_MISSING";
        return decision("would_conflict", reasonCode, [
          target("crm.employer_requisite", "would_conflict", reasonCode),
        ]);
      }
      if (!asFlag(payload, "PARENT_IS_READY")) {
        const reasonCode = "EMPLOYER_REQUISITE_PARENT_NOT_READY";
        return decision("would_quarantine", reasonCode, [
          target("crm.employer_requisite", "would_quarantine", reasonCode),
        ]);
      }
      if (asInteger(payload, "NORMALIZED_TAX_ID_DUPLICATE_COUNT") > 1) {
        const reasonCode = "EMPLOYER_TAX_ID_DUPLICATE_REQUIRES_REVIEW";
        return decision("would_conflict", reasonCode, [
          target("crm.employer_requisite", "would_conflict", reasonCode),
          target("migration.duplicate_signal", "would_migrate"),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        target("crm.employer_requisite", "would_migrate"),
      ]);
    },
  },
  {
    classifierId: "crm-case-safe-v2",
    dependsOn: ["b_user", "b_crm_contact", "b_crm_company"],
    executionOrder: 60,
    expectedProjectionCounts: {
      would_conflict: 539,
      would_exclude: 0,
      would_migrate: 1237,
      would_quarantine: 123,
    },
    requiredColumns: [
      "ID",
      "TITLE",
      "CATEGORY_ID",
      "OWNER_EXISTS",
      "OWNER_IS_ACTIVE",
      "CONTACT_EXISTS",
      "CONTACT_IS_READY",
      "COMPANY_REFERENCE_IS_READY",
    ],
    sourceTable: "b_crm_deal",
    transformVersion: "crm-case-v2",
    validationRules: [
      "deal TITLE is the canonical case title source",
      "only signed category 2 funnel/stage mappings are directly projectable",
      "primary contact must exist and its base transform must be ready",
      "inactive operational owner requires a signed reassignment",
      "optional company references must resolve to a ready employer",
    ],
    classify(payload) {
      if (!isNonBlank(payload.TITLE)) {
        const reasonCode = "CASE_TITLE_REQUIRED";
        return decision("would_conflict", reasonCode, [target("crm.crm_case", "would_conflict", reasonCode)]);
      }
      if (!asFlag(payload, "OWNER_EXISTS")) {
        const reasonCode = "CASE_OWNER_ACTOR_MISSING";
        return decision("would_conflict", reasonCode, [target("crm.crm_case", "would_conflict", reasonCode)]);
      }
      if (!asFlag(payload, "OWNER_IS_ACTIVE")) {
        const reasonCode = "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT";
        return decision("would_quarantine", reasonCode, [
          target("crm.crm_case", "would_migrate"),
          target("crm.case_assignment", "would_quarantine", reasonCode, "link"),
        ]);
      }
      if (asInteger(payload, "CATEGORY_ID") !== 2) {
        const reasonCode = "CASE_FUNNEL_MAPPING_REQUIRES_SIGNED_DECISION";
        return decision("would_conflict", reasonCode, [target("crm.crm_case", "would_conflict", reasonCode)]);
      }
      if (!asFlag(payload, "CONTACT_EXISTS")) {
        const reasonCode = "CASE_PRIMARY_CONTACT_UNRESOLVED";
        return decision("would_conflict", reasonCode, [
          target("crm.crm_case", "would_conflict", reasonCode),
          target("crm.case_person", "would_conflict", reasonCode, "link"),
        ]);
      }
      if (!asFlag(payload, "CONTACT_IS_READY") || !asFlag(payload, "COMPANY_REFERENCE_IS_READY")) {
        const reasonCode = "CASE_DEPENDENCY_NOT_READY";
        return decision("would_quarantine", reasonCode, [
          target("crm.crm_case", "would_quarantine", reasonCode),
        ]);
      }
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        target("crm.crm_case", "would_migrate"),
        target("crm.case_person", "would_migrate", undefined, "link"),
        target("crm.case_assignment", "would_migrate", undefined, "link"),
      ]);
    },
  },
  {
    classifierId: "legacy-task-domain-v2",
    dependsOn: ["b_user"],
    executionOrder: 70,
    expectedProjectionCounts: {
      would_conflict: 27,
      would_exclude: 0,
      would_migrate: 61,
      would_quarantine: 1,
    },
    requiredColumns: [
      "ID",
      "RESPONSIBLE_EXISTS",
      "RESPONSIBLE_IS_ACTIVE",
      "CRM_DOMAIN_EVIDENCE",
      "PROJECT_DOMAIN_EVIDENCE",
    ],
    sourceTable: "b_tasks",
    transformVersion: "legacy-task-v2",
    validationRules: [
      "CRM evidence is non-empty UF_CRM_TASK excluding serialized empty arrays",
      "project evidence is GROUP_ID > 0",
      "dual-use and neither-domain rows require a signed domain decision",
      "inactive responsible owner requires a signed reassignment",
    ],
    classify(payload) {
      if (!asFlag(payload, "RESPONSIBLE_EXISTS")) {
        const reasonCode = "TASK_RESPONSIBLE_ACTOR_MISSING";
        return decision("would_conflict", reasonCode, [
          target("migration.conflict", "would_migrate", undefined, "stage"),
        ]);
      }
      if (!asFlag(payload, "RESPONSIBLE_IS_ACTIVE")) {
        const reasonCode = "INACTIVE_OPERATIONAL_OWNER_REQUIRES_SIGNED_REASSIGNMENT";
        return decision("would_quarantine", reasonCode, [
          target("crm.crm_task", "would_quarantine", reasonCode),
        ]);
      }
      const crm = asFlag(payload, "CRM_DOMAIN_EVIDENCE");
      const project = asFlag(payload, "PROJECT_DOMAIN_EVIDENCE");
      if (crm === project) {
        const reasonCode = crm ? "TASK_DOMAIN_DUAL_USE_REQUIRES_DECISION" : "TASK_DOMAIN_UNRESOLVED";
        return decision("would_conflict", reasonCode, [
          target("migration.conflict", "would_migrate", undefined, "stage"),
        ]);
      }
      const taskTarget = crm ? "crm.crm_task" : "project.project_task";
      const assignmentTarget = crm ? "crm.task_assignment" : "project.task_assignment";
      return decision("would_migrate", "DRY_RUN_WOULD_MIGRATE", [
        target(taskTarget, "would_migrate"),
        target(assignmentTarget, "would_migrate", undefined, "link"),
      ]);
    },
  },
] as const;

const contractByIdentity = new Map(
  contracts.map((contract) => [`${contract.sourceTable}:${contract.transformVersion}`, contract] as const),
);
const contractsBySourceTable = new Map(
  contracts.map((contract) => [contract.sourceTable, contract] as const),
);

export function canonicalTransformContracts(): readonly CanonicalTransformContract[] {
  return contracts;
}

export function getCanonicalTransformContract(
  sourceTable: string,
  transformVersion: string,
): CanonicalTransformContract | undefined {
  return contractByIdentity.get(`${sourceTable}:${transformVersion}`);
}

export function getCanonicalTransformContractForSource(
  sourceTable: string,
): CanonicalTransformContract | undefined {
  return contractsBySourceTable.get(sourceTable);
}

function payloadRecord(item: MigrationPlanItem, row: LegacyRowEnvelope): Readonly<Record<string, unknown>> {
  if (typeof row.payload !== "object" || row.payload === null || Array.isArray(row.payload)) {
    throw new MigrationError(
      "CANONICAL_TRANSFORM_INPUT_INVALID",
      `Canonical transform received a non-object payload for ${item.sourceTable}`,
    );
  }
  return row.payload as Readonly<Record<string, unknown>>;
}

export function classifyWithCanonicalTransform(
  item: MigrationPlanItem,
  row: LegacyRowEnvelope,
): MigrationDecision {
  if (item.sourceDisposition === "quarantine_only") {
    return decision("would_quarantine", "SOURCE_TABLE_QUARANTINE_ONLY", []);
  }

  const contract = getCanonicalTransformContract(item.sourceTable, item.transformVersion);
  if (contract === undefined) {
    return decision("would_quarantine", "CANONICAL_TRANSFORM_NOT_REGISTERED", []);
  }
  if (contract.classifierId !== item.classifierId) {
    throw new MigrationError(
      "CANONICAL_TRANSFORM_REGISTRY_MISMATCH",
      `Migration plan classifier does not match the canonical transform registry for ${item.sourceTable}`,
    );
  }

  const payload = payloadRecord(item, row);
  const missingColumn = contract.requiredColumns.find((column) => !Object.hasOwn(payload, column));
  if (missingColumn !== undefined) {
    throw new MigrationError(
      "CANONICAL_TRANSFORM_INPUT_INVALID",
      `Registered source query omitted classifier column ${missingColumn} for ${item.sourceTable}`,
    );
  }
  return contract.classify(payload);
}
