#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const generatedDirectory = path.join(repositoryRoot, "docs/cabinet/generated");

const files = {
  dump: path.join(repositoryRoot, "sitemanager-final.sql.gz"),
  schemaInventory: path.join(repositoryRoot, "docs/migration/generated/schema-inventory.json"),
  requirements: path.join(generatedDirectory, "requirements-crosswalk.csv"),
  manifest: path.join(generatedDirectory, "migration-scope-manifest.json"),
  sourceFieldMap: path.join(generatedDirectory, "source-field-map.json"),
  tableDispositions: path.join(generatedDirectory, "source-table-dispositions.csv"),
  columnDispositions: path.join(generatedDirectory, "column-disposition-manifest.json"),
  migrationQueries: path.join(generatedDirectory, "migration-query-registry.json"),
  targetModel: path.join(generatedDirectory, "target-model-registry.json"),
};

const SNAPSHOT_SHA256 =
  "7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf";
const EXPECTED_SOURCE_TABLES = 1669;
const EXPECTED_MANIFEST_TABLES = 57;
const EXPECTED_INCLUDED_TABLES = 55;
const EXPECTED_QUARANTINE_TABLES = 2;
const EXPECTED_ROW_OUTCOMES = 438424;
const EXPECTED_REQUIREMENT_QUERIES = 28;

const CRM_UF_PROFILE_TABLE_TOTALS = {
  b_uts_crm_contact: 3186,
  b_uts_crm_deal: 1898,
  b_crm_dynamic_items_1042: 1808,
};

const CRM_UF_ENTITY_IDS = {
  b_uts_crm_contact: "CRM_CONTACT",
  b_uts_crm_deal: "CRM_DEAL",
  b_crm_dynamic_items_1042: "CRM_4",
};

const INACTIVE_OWNER_BASELINE = {
  contacts: 458,
  deals: 70,
  companies: 88,
  employer_referrals: 0,
  tasks: 1,
  total: 617,
  unresolved: 0,
};

const SOURCE_FIELD_TARGET_ALIASES = {
  attachment: "platform.attachment",
  consent: "crm.consent_snapshot",
  crm_case: "crm.crm_case",
  crm_profile: "crm.crm_profile",
  employer_referral: "crm.employer_referral",
  program_participation: "crm.program_participation",
  recommendation: "crm.recommender_link",
  relocation_profile: "crm.relocation_profile",
};

const CUSTOM_FIELD_IDS = [
  14, 40, 84, 114, 119, 120, 128, 129, 167, 169, 170, 171, 183, 189, 194, 196,
  200, 206, 223, 224, 225, 233, 250, 251, 252, 253, 254, 255, 263, 267, 310,
  332, 341, 345, 356, 358, 359, 360, 361, 375, 383, 384, 385, 386, 404, 406,
];

const ENUM_FIELD_COUNTS = {
  171: 9,
  200: 17,
  250: 8,
  356: 99,
  361: 8,
  386: 2,
};

const MULTIVALUE_CANONICAL_FIELD_IDS = [189, 194, 254, 341, 345, 375, 404];

const STATUS_ENTITY_COUNTS = {
  DEAL_STAGE: 11,
  DEAL_STAGE_1: 18,
  DEAL_STAGE_2: 8,
  DEAL_STAGE_3: 13,
  DEAL_STAGE_5: 8,
  DYNAMIC_1042_STAGE_8: 9,
  CONTACT_TYPE: 7,
  COMPANY_TYPE: 2,
  SOURCE: 17,
  EVENT_TYPE: 3,
};

const STAGE_GROUP_TO_ENTITY = {
  "DEAL_STAGE/category_0": "DEAL_STAGE",
  "DEAL_STAGE_1/category_1": "DEAL_STAGE_1",
  "DEAL_STAGE_2/category_2": "DEAL_STAGE_2",
  "DEAL_STAGE_3/category_3": "DEAL_STAGE_3",
  "DEAL_STAGE_5/category_5": "DEAL_STAGE_5",
  DYNAMIC_1042_STAGE_8: "DYNAMIC_1042_STAGE_8",
};

const DEAL_STAGE_ENTITY_BY_CATEGORY = {
  0: "DEAL_STAGE",
  1: "DEAL_STAGE_1",
  2: "DEAL_STAGE_2",
  3: "DEAL_STAGE_3",
  5: "DEAL_STAGE_5",
};

const requirementQueryDefinitions = {
  "MIG-Q-ACTIVITIES-001": {
    query_kind: "referential_integrity",
    result_type: "object",
    source_tables: ["b_crm_act", "b_crm_act_bind", "b_crm_act_comm", "b_crm_act_elem"],
    metric: "activity_target_and_delivery_coverage",
    expected_rule: {
      operator: "all_selected_rows_have_target_or_reasoned_exclusion",
      blocking: true,
    },
  },
  "MIG-Q-CASEPERSON-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: [
      "b_crm_contact",
      "b_crm_deal",
      "b_crm_deal_contact",
      "b_crm_event_relations",
    ],
    metric: "deal_candidate_resolution",
    expected_rule: {
      operator: "equals_object",
      value: { direct: 1514, event_recovered: 2, explicit_conflict: 383, total: 1899 },
      blocking: true,
    },
  },
  "MIG-Q-CONFLICT-001": {
    query_kind: "cutover_invariant",
    result_type: "integer",
    source_tables: [],
    metric: "unresolved_blocking_migration_conflicts",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-CRM-001": {
    query_kind: "coverage",
    result_type: "object",
    source_tables: [
      "b_crm_contact",
      "b_crm_company",
      "b_crm_deal",
      "b_crm_dynamic_items_1042",
      "b_crm_act",
      "b_crm_event",
      "b_crm_timeline",
    ],
    metric: "crm_domain_row_outcomes",
    expected_rule: {
      operator: "all_manifest_rows_have_exactly_one_outcome",
      denominator_ref: "migration-scope-manifest.json#row_outcome_contract",
      blocking: true,
    },
  },
  "MIG-Q-DASH-001": {
    query_kind: "target_consistency",
    result_type: "boolean",
    source_tables: [],
    metric: "dashboard_aggregates_match_canonical_queries",
    expected_rule: { operator: "is_true", blocking: true },
  },
  "MIG-Q-DEALS-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: ["b_crm_deal", "b_crm_deal_category", "b_crm_status"],
    metric: "deal_category_and_stage_distribution",
    expected_rule: {
      operator: "equals_source_field_map_distribution",
      reference: "source-field-map.json#/funnel_categories",
      blocking: true,
    },
  },
  "MIG-Q-DUPLICATES-001": {
    query_kind: "safety_invariant",
    result_type: "integer",
    source_tables: ["b_crm_contact", "b_crm_field_multi"],
    metric: "automatic_merges_without_approved_decision",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-EMPLOYEE-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: [
      "b_user",
      "b_utm_user",
      "b_iblock_section",
      "b_uts_iblock_3_section",
    ],
    metric: "legacy_actor_and_employee_classification",
    expected_rule: {
      operator: "equals_object",
      value: {
        legacy_actor_outcomes: 218,
        employee_candidates: 20,
        department_assignments: 29,
        department_units: 5,
        department_heads: 5,
      },
      blocking: true,
    },
  },
  "MIG-Q-FILES-001": {
    query_kind: "file_integrity",
    result_type: "object",
    source_tables: [
      "b_file",
      "b_file_hash",
      "b_disk_object",
      "b_disk_version",
      "b_disk_attached_object",
      "b_disk_right",
      "b_disk_simple_right",
      "b_disk_sharing",
      "b_disk_storage",
    ],
    metric: "file_migration_mode_compliance",
    expected_rule: {
      operator: "satisfies_file_mode_contract",
      reference: "migration-scope-manifest.json#/file_migration_contract",
      blocking: true,
    },
  },
  "MIG-Q-MANIFEST-001": {
    query_kind: "source_snapshot_integrity",
    result_type: "boolean",
    source_tables: [],
    metric: "snapshot_schema_counts_and_manifest_match",
    expected_rule: { operator: "is_true", blocking: true },
  },
  "MIG-Q-OWNERS-001": {
    query_kind: "signed_record_reconciliation",
    result_type: "object",
    source_tables: [
      "b_user",
      "b_crm_contact",
      "b_crm_company",
      "b_crm_deal",
      "b_crm_dynamic_items_1042",
      "b_tasks",
    ],
    metric: "inactive_operational_owner_signed_outcomes",
    classifier_id: "inactive-operational-owner-v1",
    executor_id: "migration.reconcile_inactive_operational_owners.v1",
    baseline: INACTIVE_OWNER_BASELINE,
    per_record_outcome_contract_ref:
      "migration-scope-manifest.json#/inactive_owner_resolution_contract",
    expected_rule: {
      operator: "equals_object",
      value: INACTIVE_OWNER_BASELINE,
      per_record_signed_outcomes: INACTIVE_OWNER_BASELINE.total,
      unresolved: 0,
      blocking: true,
    },
  },
  "MIG-Q-PMROLES-001": {
    query_kind: "authorization_invariant",
    result_type: "integer",
    source_tables: [],
    metric: "invalid_project_role_assignments",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-PMSTATUS-001": {
    query_kind: "state_machine_invariant",
    result_type: "integer",
    source_tables: [],
    metric: "project_task_transitions_outside_catalog",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-PMTASK-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: ["b_tasks", "b_tasks_member"],
    metric: "project_tasks_with_invalid_hierarchy_or_executor",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-PROJECTS-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: [],
    metric: "projects_with_invalid_direction_or_archive_history",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-RECOMMENDER-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: [
      "b_crm_contact",
      "b_crm_deal",
      "b_uts_crm_contact",
      "b_uts_crm_deal",
    ],
    metric: "unresolved_recommender_or_document_references",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-RECON-001": {
    query_kind: "cutover_invariant",
    result_type: "boolean",
    source_tables: [],
    metric: "reconciliation_freeze_delta_and_rollback_evidence_complete",
    expected_rule: { operator: "is_true", blocking: true },
  },
  "MIG-Q-REFERRALS-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: [
      "b_crm_dynamic_items_1042",
      "b_crm_entity_relation",
      "b_crm_company",
    ],
    metric: "employer_referral_outcomes",
    expected_rule: {
      operator: "equals_object",
      value: { total: 1808, complete: 1795, explicit_conflict: 13 },
      blocking: true,
    },
  },
  "MIG-Q-RELATIONS-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: [
      "b_utm_user",
      "b_user_group",
      "b_crm_deal_contact",
      "b_crm_entity_relation",
      "b_tasks_member",
    ],
    metric: "selected_relations_without_target_or_explicit_outcome",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-RELOCATION-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: [
      "b_crm_deal",
      "b_uts_crm_deal",
      "b_utm_crm_deal",
      "b_crm_status",
    ],
    metric: "relocation_case_distribution",
    expected_rule: {
      operator: "equals_source_field_map_distribution",
      reference: "source-field-map.json#/stages/DEAL_STAGE_2~1category_2",
      blocking: true,
    },
  },
  "MIG-Q-REPORT-001": {
    query_kind: "target_consistency",
    result_type: "integer",
    source_tables: [],
    metric: "report_runs_with_unversioned_formula_or_nonreproducible_result",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-ROLES-001": {
    query_kind: "authorization_invariant",
    result_type: "integer",
    source_tables: ["b_group", "b_user_group"],
    metric: "target_role_grants_without_approved_policy_evidence",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-SECRET-001": {
    query_kind: "security_scan",
    result_type: "integer",
    source_tables: ["b_user"],
    metric: "legacy_secrets_in_target_or_export_artifacts",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-SOURCE-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: [
      "b_crm_contact",
      "b_crm_deal",
      "b_uts_crm_contact",
      "b_uts_crm_deal",
    ],
    metric: "cases_missing_required_source_or_consent_snapshot_provenance",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-STAGES-001": {
    query_kind: "state_machine_invariant",
    result_type: "integer",
    source_tables: ["b_crm_deal", "b_crm_status", "b_crm_dynamic_items_1042"],
    metric: "source_stage_codes_without_versioned_target_mapping",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-TASKCLASS-001": {
    query_kind: "classification_invariant",
    result_type: "object",
    source_tables: ["b_tasks", "b_tasks_member"],
    metric: "legacy_task_classification",
    expected_rule: {
      operator: "equals_object",
      value: { crm_only: 39, project_only: 23, dual_use_review: 21, neither: 6, total: 89 },
      blocking: true,
    },
  },
  "MIG-Q-TASKS-001": {
    query_kind: "referential_integrity",
    result_type: "integer",
    source_tables: ["b_tasks", "b_tasks_member"],
    metric: "crm_tasks_without_history_or_responsible_outcome",
    expected_rule: { operator: "equals", value: 0, blocking: true },
  },
  "MIG-Q-USERS-001": {
    query_kind: "reconciliation_aggregate",
    result_type: "object",
    source_tables: ["b_user", "b_utm_user", "b_iblock_section"],
    metric: "legacy_user_outcomes",
    expected_rule: {
      operator: "equals_object",
      value: {
        total: 218,
        employee_candidates: 20,
        connector_actors: 191,
        bot_actors: 6,
        anonymous_actors: 1,
      },
      blocking: true,
    },
  },
};

const metadataSchemas = {
  b_user_field: [
    "ID",
    "ENTITY_ID",
    "FIELD_NAME",
    "USER_TYPE_ID",
    "XML_ID",
    "SORT",
    "MULTIPLE",
    "MANDATORY",
    "SHOW_FILTER",
    "SHOW_IN_LIST",
    "EDIT_IN_LIST",
    "IS_SEARCHABLE",
    "SETTINGS",
  ],
  b_user_field_lang: [
    "USER_FIELD_ID",
    "LANGUAGE_ID",
    "EDIT_FORM_LABEL",
    "LIST_COLUMN_LABEL",
    "LIST_FILTER_LABEL",
    "ERROR_MESSAGE",
    "HELP_MESSAGE",
  ],
  b_user_field_enum: ["ID", "USER_FIELD_ID", "VALUE", "DEF", "SORT", "XML_ID"],
  b_crm_status: [
    "ID",
    "ENTITY_ID",
    "STATUS_ID",
    "NAME",
    "NAME_INIT",
    "SORT",
    "SYSTEM",
    "COLOR",
    "SEMANTICS",
    "CATEGORY_ID",
  ],
  b_tasks_member: ["TASK_ID", "USER_ID", "TYPE"],
};

const additionalManifestEntities = [
  {
    source_table: "b_user_field",
    primary_key: ["ID"],
    baseline_count: 366,
    selected_columns: [
      "ID",
      "ENTITY_ID",
      "FIELD_NAME",
      "USER_TYPE_ID",
      "XML_ID",
      "SORT",
      "MULTIPLE",
      "MANDATORY",
      "SETTINGS",
    ],
    inclusion_rule: "all rows classified; 46 versioned custom-field definitions are included",
    selection_baseline_count: 46,
    target: ["migration.source_field_definition"],
    transform_version: "source-field-definition-v1",
    reconciliation: "46 selected definitions; every one of 366 rows has an outcome",
  },
  {
    source_table: "b_user_field_lang",
    primary_key: ["USER_FIELD_ID", "LANGUAGE_ID"],
    baseline_count: 660,
    selected_columns: [
      "USER_FIELD_ID",
      "LANGUAGE_ID",
      "EDIT_FORM_LABEL",
      "LIST_COLUMN_LABEL",
      "LIST_FILTER_LABEL",
    ],
    inclusion_rule:
      "all rows classified; Russian labels for the 46 selected custom fields are included",
    selection_baseline_count: 46,
    target: ["migration.source_field_label"],
    transform_version: "source-field-label-v1",
    reconciliation: "46 Russian source labels; every one of 660 rows has an outcome",
  },
  {
    source_table: "b_user_field_enum",
    primary_key: ["ID"],
    baseline_count: 650,
    selected_columns: ["ID", "USER_FIELD_ID", "VALUE", "DEF", "SORT", "XML_ID"],
    inclusion_rule:
      "all rows classified; enum values for fields 171, 200, 250, 356, 361 and 386 are included",
    selection_baseline_count: 143,
    target: ["migration.source_enum_value"],
    transform_version: "source-enum-value-v1",
    reconciliation: "143 selected enum values; every one of 650 rows has an outcome",
  },
  {
    source_table: "b_crm_status",
    primary_key: ["ID"],
    baseline_count: 172,
    selected_columns: [
      "ID",
      "ENTITY_ID",
      "STATUS_ID",
      "NAME",
      "NAME_INIT",
      "SORT",
      "SYSTEM",
      "COLOR",
      "SEMANTICS",
      "CATEGORY_ID",
    ],
    inclusion_rule:
      "all rows classified; six workflow groups plus CONTACT_TYPE, COMPANY_TYPE, SOURCE and EVENT_TYPE are included",
    selection_baseline_count: 96,
    target: ["migration.source_status_definition"],
    transform_version: "source-status-definition-v1",
    reconciliation: "96 selected status definitions; every one of 172 rows has an outcome",
  },
  {
    source_table: "b_crm_deal_category",
    primary_key: ["ID"],
    baseline_count: 4,
    selected_columns: [
      "ID",
      "CREATED_DATE",
      "NAME",
      "IS_LOCKED",
      "SORT",
      "ORIGIN_ID",
      "ORIGINATOR_ID",
    ],
    inclusion_rule: "all rows",
    selection_baseline_count: 4,
    target: ["migration.source_category_definition"],
    transform_version: "source-deal-category-v1",
    reconciliation:
      "4 explicit category rows; category 0 is separately recorded as implicit source default",
  },
  {
    source_table: "b_crm_dynamic_type",
    primary_key: ["ID"],
    baseline_count: 4,
    selected_columns: [
      "ID",
      "ENTITY_TYPE_ID",
      "CODE",
      "NAME",
      "TITLE",
      "TABLE_NAME",
      "CREATED_BY",
      "IS_CATEGORIES_ENABLED",
      "IS_STAGES_ENABLED",
      "IS_CLIENT_ENABLED",
      "CREATED_TIME",
      "UPDATED_TIME",
      "UPDATED_BY",
    ],
    inclusion_rule: "all rows classified; ENTITY_TYPE_ID=1042 is included",
    selection_baseline_count: 1,
    target: ["migration.source_dynamic_type_definition"],
    transform_version: "source-dynamic-type-v1",
    reconciliation: "one selected dynamic type; every one of 4 rows has an outcome",
  },
  {
    source_table: "b_crm_item_category",
    primary_key: ["ID"],
    baseline_count: 8,
    selected_columns: [
      "ID",
      "ENTITY_TYPE_ID",
      "IS_DEFAULT",
      "IS_SYSTEM",
      "CODE",
      "CREATED_DATE",
      "NAME",
      "SORT",
      "SETTINGS",
    ],
    inclusion_rule: "all rows classified; ENTITY_TYPE_ID=1042 and ID=8 is included",
    selection_baseline_count: 1,
    target: ["migration.source_dynamic_category_definition"],
    transform_version: "source-dynamic-category-v1",
    reconciliation: "one selected category; every one of 8 rows has an outcome",
  },
  {
    source_table: "b_iblock",
    primary_key: ["ID"],
    baseline_count: 37,
    selected_columns: [
      "ID",
      "TIMESTAMP_X",
      "IBLOCK_TYPE_ID",
      "CODE",
      "API_CODE",
      "NAME",
      "ACTIVE",
      "SORT",
      "XML_ID",
      "VERSION",
    ],
    inclusion_rule: "all rows classified; iblocks 3 and 21 are included",
    selection_baseline_count: 2,
    target: ["migration.source_lookup_definition"],
    transform_version: "source-iblock-definition-v1",
    reconciliation: "department and settlement iblocks selected; all 37 rows have an outcome",
  },
  {
    source_table: "b_iblock_element",
    primary_key: ["ID"],
    baseline_count: 3591,
    selected_columns: [
      "ID",
      "TIMESTAMP_X",
      "MODIFIED_BY",
      "DATE_CREATE",
      "CREATED_BY",
      "IBLOCK_ID",
      "IBLOCK_SECTION_ID",
      "ACTIVE",
      "SORT",
      "NAME",
      "XML_ID",
      "CODE",
    ],
    inclusion_rule: "all rows classified; IBLOCK_ID=21 settlement dictionary rows are included",
    selection_baseline_count: 61,
    target: ["crm.settlement_dictionary"],
    transform_version: "settlement-dictionary-v1",
    reconciliation:
      "61 dictionary rows; 701 uses, 29 distinct used IDs and zero invalid references",
  },
  {
    source_table: "b_uts_iblock_3_section",
    primary_key: ["VALUE_ID"],
    baseline_count: 5,
    selected_columns: ["VALUE_ID", "UF_HEAD"],
    inclusion_rule: "all rows",
    selection_baseline_count: 5,
    target: ["identity.organization_unit_head"],
    transform_version: "organization-unit-head-v1",
    reconciliation: "5 department head links; all point to valid legacy user 3",
  },
  {
    source_table: "b_crm_deal_stage_history",
    primary_key: ["ID"],
    baseline_count: 4619,
    selected_columns: [
      "ID",
      "TYPE_ID",
      "OWNER_ID",
      "CREATED_TIME",
      "CREATED_DATE",
      "EFFECTIVE_DATE",
      "START_DATE",
      "END_DATE",
      "PERIOD_YEAR",
      "PERIOD_QUARTER",
      "PERIOD_MONTH",
      "START_PERIOD_YEAR",
      "START_PERIOD_QUARTER",
      "START_PERIOD_MONTH",
      "END_PERIOD_YEAR",
      "END_PERIOD_QUARTER",
      "END_PERIOD_MONTH",
      "RESPONSIBLE_ID",
      "CATEGORY_ID",
      "STAGE_SEMANTIC_ID",
      "STAGE_ID",
      "IS_LOST",
    ],
    inclusion_rule:
      "all rows classified by category and versioned stage map; unmapped/reversed rows become blocking conflicts",
    selection_baseline_count: 3932,
    selection_conflict_baseline_count: 687,
    classifier_id: "crm-case-stage-history-category-stage-v1",
    target: ["crm.case_stage_history", "migration.conflict"],
    transform_version: "crm-case-stage-history-v1",
    reconciliation:
      "4 619 rows = 3 932 mapped canonical history + 687 blocking conflicts; all owner/responsible references valid",
  },
  {
    source_table: "b_crm_deal_stage_history_with_supposed",
    primary_key: ["ID"],
    baseline_count: 9399,
    selected_columns: [
      "ID",
      "OWNER_ID",
      "CREATED_TIME",
      "CREATED_DATE",
      "CATEGORY_ID",
      "STAGE_SEMANTIC_ID",
      "STAGE_ID",
      "IS_LOST",
      "IS_SUPPOSED",
      "LAST_UPDATE_DATE",
      "CLOSE_DATE",
      "SPENT_TIME",
    ],
    inclusion_rule:
      "all rows enter restricted quarantine until supposed-stage semantics receive a signed owner decision",
    selection_baseline_count: 9399,
    classifier_id: "crm-supposed-stage-history-quarantine-v1",
    source_disposition: "quarantine_only",
    required_row_outcome: "quarantined",
    target: ["migration.crm_stage_history_quarantine"],
    transform_version: "crm-supposed-case-stage-history-quarantine-v1",
    reconciliation: "9 399 rows have quarantine ledger outcomes; none silently become canonical history",
  },
  {
    source_table: "b_crm_entity_stage_history",
    primary_key: ["ID"],
    baseline_count: 3201,
    selected_columns: [
      "ID",
      "TYPE_ID",
      "OWNER_TYPE_ID",
      "OWNER_ID",
      "CREATED_TIME",
      "CREATED_DATE",
      "EFFECTIVE_DATE",
      "START_DATE",
      "END_DATE",
      "PERIOD_YEAR",
      "PERIOD_QUARTER",
      "PERIOD_MONTH",
      "START_PERIOD_YEAR",
      "START_PERIOD_QUARTER",
      "START_PERIOD_MONTH",
      "END_PERIOD_YEAR",
      "END_PERIOD_QUARTER",
      "END_PERIOD_MONTH",
      "RESPONSIBLE_ID",
      "CATEGORY_ID",
      "STAGE_SEMANTIC_ID",
      "STAGE_ID",
      "IS_LOST",
    ],
    inclusion_rule: "all rows; OWNER_TYPE_ID=1042 maps to employer-referral stage history",
    selection_baseline_count: 3201,
    selection_predicate_sql: "OWNER_TYPE_ID = 1042",
    target: ["crm.employer_referral_stage_history"],
    transform_version: "crm-employer-referral-stage-history-v1",
    reconciliation:
      "3 201/3 201 rows have OWNER_TYPE_ID=1042, valid referral/responsible references and mapped stage codes",
  },
  {
    source_table: "b_crm_entity_stage_history_with_supposed",
    primary_key: ["ID"],
    baseline_count: 4271,
    selected_columns: [
      "ID",
      "OWNER_TYPE_ID",
      "OWNER_ID",
      "CREATED_TIME",
      "CREATED_DATE",
      "CATEGORY_ID",
      "STAGE_SEMANTIC_ID",
      "STAGE_ID",
      "IS_LOST",
      "IS_SUPPOSED",
      "LAST_UPDATE_DATE",
      "CLOSE_DATE",
      "SPENT_TIME",
    ],
    inclusion_rule:
      "all rows enter restricted quarantine after OWNER_TYPE_ID classification until supposed-stage semantics receive a signed owner decision",
    selection_baseline_count: 4271,
    classifier_id: "crm-entity-supposed-stage-history-quarantine-v1",
    source_disposition: "quarantine_only",
    required_row_outcome: "quarantined",
    target: ["migration.crm_stage_history_quarantine"],
    transform_version: "crm-supposed-entity-stage-history-quarantine-v1",
    reconciliation: "4 271 rows have quarantine ledger outcomes; none silently become canonical history",
  },
  {
    source_table: "b_crm_observer",
    primary_key: ["USER_ID", "ENTITY_ID", "ENTITY_TYPE_ID"],
    baseline_count: 90,
    selected_columns: [
      "ENTITY_TYPE_ID",
      "ENTITY_ID",
      "USER_ID",
      "SORT",
      "CREATED_TIME",
      "LAST_UPDATED_TIME",
    ],
    inclusion_rule: "all rows classified by ENTITY_TYPE_ID into typed perioded observer assignments",
    selection_baseline_count: 90,
    classifier_id: "crm-observer-entity-type-v1",
    target: ["crm.case_assignment", "crm.crm_profile_assignment"],
    transform_version: "crm-observer-assignment-v1",
    reconciliation:
      "90 valid observer relations: ENTITY_TYPE_ID=2 case observer 16; ENTITY_TYPE_ID=3 CRM-profile observer 74",
  },
  {
    source_table: "b_tasks_log",
    primary_key: ["ID"],
    baseline_count: 629,
    selected_columns: [
      "ID",
      "CREATED_DATE",
      "USER_ID",
      "TASK_ID",
      "FIELD",
      "FROM_VALUE",
      "TO_VALUE",
    ],
    inclusion_rule: "all rows classified by task domain and change FIELD",
    selection_baseline_count: 399,
    selection_conflict_baseline_count: 230,
    classifier_id: "legacy-task-history-domain-and-field-v1",
    target: ["crm.task_history", "project.task_history", "migration.conflict"],
    transform_version: "legacy-task-history-v1",
    reconciliation:
      "629 rows = 399 direct CRM/project history + 230 domain/current-task conflicts; 9 missing user refs are typed system UF task events, never invented employees",
  },
  {
    source_table: "b_tasks_task_dep",
    primary_key: ["TASK_ID", "PARENT_TASK_ID", "DIRECT"],
    baseline_count: 4,
    selected_columns: ["TASK_ID", "PARENT_TASK_ID", "DIRECT"],
    inclusion_rule: "all rows classified by task domain; every dependency passes orphan and cycle checks",
    selection_baseline_count: 0,
    selection_conflict_baseline_count: 1,
    classifier_id: "legacy-task-dependency-domain-v1",
    target: ["crm.task_dependency", "project.task_dependency", "migration.conflict"],
    transform_version: "legacy-task-dependency-v1",
    reconciliation:
      "3 DIRECT=0 reflexive closure rows are explicitly excluded; 1 DIRECT=1 non-self edge matches b_tasks.PARENT_ID but remains blocking until child task domain is resolved and cycle check passes",
  },
  {
    source_table: "b_tasks_stages",
    primary_key: ["ID"],
    baseline_count: 89,
    selected_columns: [
      "ID",
      "TITLE",
      "SORT",
      "COLOR",
      "SYSTEM_TYPE",
      "ENTITY_ID",
      "ENTITY_TYPE",
    ],
    excluded_columns: ["ADDITIONAL_FILTER", "TO_UPDATE", "TO_UPDATE_ACCESS"],
    inclusion_rule:
      "all rows classified by reference usage; source definitions are evidence until an owner-approved canonical stage map exists",
    selection_baseline_count: 18,
    classifier_id: "legacy-task-stage-definition-domain-v1",
    target: ["migration.source_task_stage_definition"],
    transform_version: "legacy-task-stage-definition-v1",
    reconciliation:
      "89 rows = 18 referenced source-stage definitions + 71 explicitly unreferenced; serialized technical payloads are not directly mapped",
  },
  {
    source_table: "b_tasks_task_stage",
    primary_key: ["ID"],
    baseline_count: 174,
    selected_columns: ["ID", "TASK_ID", "STAGE_ID"],
    inclusion_rule:
      "all rows preserved as non-perioded source-stage membership evidence; no history timestamp or canonical workflow state is inferred",
    selection_baseline_count: 174,
    classifier_id: "legacy-task-stage-assignment-domain-v1",
    target: ["migration.source_task_stage_membership"],
    transform_version: "legacy-task-stage-assignment-v1",
    reconciliation:
      "174 source memberships preserved: 168 current-task refs + 6 missing-current-task refs; all stage refs valid; no temporal period is fabricated",
  },
  {
    source_table: "b_tasks_result",
    primary_key: ["ID"],
    baseline_count: 3,
    selected_columns: [
      "ID",
      "TASK_ID",
      "COMMENT_ID",
      "TEXT",
      "CREATED_BY",
      "CREATED_AT",
      "UPDATED_AT",
      "STATUS",
    ],
    inclusion_rule: "all rows classified by task domain into protected typed task-result records",
    selection_baseline_count: 3,
    selection_predicate_sql: "1 = 1",
    target: ["crm.task_result"],
    transform_version: "legacy-task-result-v1",
    reconciliation:
      "3/3 protected CRM task-result records have STATUS=1 and valid task/creator/comment references",
  },
  {
    source_table: "b_disk_right",
    primary_key: ["ID"],
    baseline_count: 284,
    selected_columns: ["ID", "OBJECT_ID", "TASK_ID", "ACCESS_CODE", "DOMAIN", "NEGATIVE"],
    inclusion_rule: "all rows classified by ACL principal and disk object resolution",
    selection_baseline_count: 284,
    classifier_id: "disk-acl-principal-v1",
    target: ["platform.attachment_acl", "migration.file_acl_conflict"],
    transform_version: "disk-object-acl-v1",
    reconciliation: "284 ACL rows resolve object and principal; unknown principal or orphan blocks FULL",
  },
  {
    source_table: "b_disk_simple_right",
    primary_key: ["ID"],
    baseline_count: 1276,
    selected_columns: ["ID", "OBJECT_ID", "ACCESS_CODE"],
    inclusion_rule: "all rows classified by ACL principal and disk object resolution",
    selection_baseline_count: 1276,
    classifier_id: "disk-simple-acl-principal-v1",
    target: ["platform.attachment_acl", "migration.file_acl_conflict"],
    transform_version: "disk-simple-object-acl-v1",
    reconciliation: "1 276 ACL rows resolve object and principal; unknown principal or orphan blocks FULL",
  },
  {
    source_table: "b_disk_sharing",
    primary_key: ["ID"],
    baseline_count: 8,
    selected_columns: [
      "ID",
      "PARENT_ID",
      "CREATED_BY",
      "FROM_ENTITY",
      "TO_ENTITY",
      "LINK_STORAGE_ID",
      "LINK_OBJECT_ID",
      "REAL_OBJECT_ID",
      "REAL_STORAGE_ID",
      "CAN_FORWARD",
      "STATUS",
      "TYPE",
      "IS_EDITABLE",
    ],
    excluded_columns: ["DESCRIPTION", "TASK_NAME"],
    inclusion_rule: "all rows classified into explicit attachment share ACL semantics",
    selection_baseline_count: 8,
    classifier_id: "disk-sharing-acl-v1",
    target: ["platform.attachment_acl", "migration.file_acl_conflict"],
    transform_version: "disk-sharing-acl-v1",
    reconciliation: "8 share rows resolve storage, object and principals; unknown/orphan blocks FULL",
  },
  {
    source_table: "b_disk_storage",
    primary_key: ["ID"],
    baseline_count: 221,
    selected_columns: [
      "ID",
      "CODE",
      "XML_ID",
      "MODULE_ID",
      "ENTITY_TYPE",
      "ENTITY_ID",
      "ROOT_OBJECT_ID",
      "USE_INTERNAL_RIGHTS",
      "SITE_ID",
    ],
    excluded_columns: ["NAME", "ENTITY_MISC_DATA"],
    inclusion_rule: "all rows classified into attachment storage ownership and ACL inheritance semantics",
    selection_baseline_count: 221,
    classifier_id: "disk-storage-owner-v1",
    target: ["platform.attachment_storage", "migration.file_acl_conflict"],
    transform_version: "disk-storage-v1",
    reconciliation: "221 storage rows resolve root object and owner; orphan or unknown owner blocks FULL",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    const next = raw[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  return rows;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalQueryId(table) {
  return `MIG-Q-${table.toUpperCase()}-V1`;
}

function quoteIdentifier(identifier) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function csvEscape(value) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function decodeSqlString(value) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    const replacements = {
      0: "\0",
      b: "\b",
      n: "\n",
      r: "\r",
      t: "\t",
      Z: "\u001a",
    };
    result += replacements[next] ?? next;
  }
  return result;
}

function parseSqlValue(value) {
  if (value === "NULL") return null;
  if (value.startsWith("'") && value.endsWith("'")) {
    return decodeSqlString(value.slice(1, -1));
  }
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function parseMysqlTuples(source) {
  const rows = [];
  let row = null;
  let field = "";
  let quoted = false;
  let escaped = false;
  let depth = 0;

  for (const character of source) {
    if (quoted) {
      field += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "'") {
        quoted = false;
      }
      continue;
    }
    if (character === "'") {
      quoted = true;
      field += character;
    } else if (character === "(") {
      if (depth === 0) {
        row = [];
        field = "";
      }
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        row.push(parseSqlValue(field));
        rows.push(row);
        row = null;
        field = "";
      } else {
        field += character;
      }
    } else if (character === "," && depth === 1) {
      row.push(parseSqlValue(field));
      field = "";
    } else if (depth > 0) {
      field += character;
    }
  }
  return rows;
}

async function extractMetadataRows(schemaInventory) {
  const output = Object.fromEntries(Object.keys(metadataSchemas).map((table) => [table, []]));
  const profileSchemas = Object.fromEntries(
    Object.keys(CRM_UF_PROFILE_TABLE_TOTALS).map((table) => [
      table,
      schemaColumns(schemaInventory, table),
    ]),
  );
  const crmUfProfiles = Object.fromEntries(
    Object.entries(profileSchemas).map(([table, columns]) => [
      table,
      {
        total_rows: 0,
        columns: Object.fromEntries(
          columns
            .filter((column) => column.startsWith("UF_"))
            .map((column) => [
              column,
              { non_null_count: 0, non_empty_count: 0 },
            ]),
        ),
      },
    ]),
  );
  const stream = fs.createReadStream(files.dump).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    const match = line.match(/^INSERT INTO `([^`]+)` VALUES (.*);$/);
    if (!match || (!(match[1] in metadataSchemas) && !(match[1] in profileSchemas))) continue;
    const table = match[1];
    for (const values of parseMysqlTuples(match[2])) {
      if (table in metadataSchemas) {
        const row = {};
        metadataSchemas[table].forEach((column, index) => {
          row[column] = values[index];
        });
        output[table].push(row);
      }
      if (table in profileSchemas) {
        crmUfProfiles[table].total_rows += 1;
        profileSchemas[table].forEach((column, index) => {
          const profile = crmUfProfiles[table].columns[column];
          if (!profile) return;
          const value = values[index];
          if (value !== null) profile.non_null_count += 1;
          if (value !== null && value !== "") profile.non_empty_count += 1;
        });
      }
    }
  }
  for (const [table, expectedRows] of Object.entries(CRM_UF_PROFILE_TABLE_TOTALS)) {
    if (crmUfProfiles[table].total_rows !== expectedRows) {
      throw new Error(
        `${table} UF profile rows: expected ${expectedRows}, found ${crmUfProfiles[table].total_rows}`,
      );
    }
  }
  return { rows: output, crmUfProfiles };
}

function validateTaskMemberTypes(rows) {
  const counts = { A: 0, O: 0, R: 0, unknown: 0 };
  for (const row of rows) {
    if (row.TYPE in counts && row.TYPE !== "unknown") {
      counts[row.TYPE] += 1;
    } else {
      counts.unknown += 1;
    }
  }
  const expected = { A: 9, O: 89, R: 89, unknown: 0 };
  if (!arraysEqual(counts, expected)) {
    throw new Error(
      `b_tasks_member TYPE distribution mismatch: ${JSON.stringify(counts)} != ${JSON.stringify(expected)}`,
    );
  }
}

function schemaColumns(schemaInventory, table) {
  const definition = schemaInventory.tables[table];
  if (!definition) throw new Error(`Table absent from schema inventory: ${table}`);
  return definition.columns.map((column) => column.name);
}

function sourceKeyFor(entity, schemaInventory) {
  const table = schemaInventory.tables[entity.source_table];
  const columns = entity.primary_key;
  const primaryColumns = (table.primary_key?.columns ?? []).map((column) => column.name);
  if (arraysEqual(columns, primaryColumns)) {
    return { kind: "primary_key", constraint: "PRIMARY", columns };
  }
  const unique = (table.unique_keys ?? []).find((key) =>
    arraysEqual(
      columns,
      key.columns.map((column) => column.name),
    ),
  );
  if (!unique) {
    throw new Error(
      `Source key is not backed by a primary or unique key: ${entity.source_table}(${columns.join(",")})`,
    );
  }
  return { kind: "unique_index", constraint: unique.name, columns };
}

function normalizeManifest(
  manifest,
  schemaInventory,
  rawCrmUfProfiles,
  metadataRows,
) {
  const byTable = new Map(manifest.entities.map((entity) => [entity.source_table, entity]));
  for (const entity of additionalManifestEntities) byTable.set(entity.source_table, entity);

  const user = byTable.get("b_user");
  user.target = [
    "identity.person",
    "identity.legacy_actor",
    "identity.employee_profile",
  ];
  user.conditional_target =
    "reviewed identity.user_account only for approved active department-linked employees";
  user.selected_columns = [
    "ID",
    "TIMESTAMP_X",
    "ACTIVE",
    "BLOCKED",
    "LOGIN",
    "EXTERNAL_AUTH_ID",
    "NAME",
    "LAST_NAME",
    "SECOND_NAME",
    "EMAIL",
    "PERSONAL_PHONE",
    "PERSONAL_MOBILE",
    "WORK_PHONE",
    "WORK_POSITION",
    "DATE_REGISTER",
    "LAST_LOGIN",
    "LAST_ACTIVITY_DATE",
  ];
  user.excluded_columns = ["PASSWORD", "CHECKWORD", "STORED_HASH", "CONFIRM_CODE", "BX_USER_ID"];

  const userMembership = byTable.get("b_utm_user");
  userMembership.primary_key = ["ID"];
  userMembership.target = [
    "identity.employee_unit_membership",
    "migration.conflict",
  ];

  byTable.get("b_crm_contact").target = [
    "identity.person",
    "crm.crm_profile",
    "crm.program_participation",
    "crm.crm_profile_assignment",
  ];
  byTable.get("b_crm_company").target = [
    "crm.employer",
    "crm.employer_assignment",
  ];
  byTable.get("b_crm_deal").target = [
    "crm.crm_case",
    "crm.case_assignment",
  ];
  byTable.get("b_crm_dynamic_items_1042").target = [
    "crm.employer_referral",
    "crm.employer_referral_assignment",
  ];
  byTable.get("b_tasks").target = [
    "crm.crm_task",
    "project.project_task",
    "crm.task_assignment",
    "project.task_assignment",
    "migration.conflict",
  ];
  const taskMembers = byTable.get("b_tasks_member");
  taskMembers.target = [
    "crm.task_assignment",
    "project.task_assignment",
    "migration.conflict",
  ];
  taskMembers.reconciliation =
    "187 valid actor references: A=co_executor 9, O=originator 89, R=responsible 89, unknown=0 blocking conflicts";

  byTable.get("b_utm_crm_contact").primary_key = ["ID"];
  byTable.get("b_utm_crm_deal").primary_key = ["ID"];
  byTable.get("b_utm_crm_timeline").primary_key = ["ID"];

  const contactUts = byTable.get("b_uts_crm_contact");
  contactUts.selected_columns = [
    "VALUE_ID",
    "UF_CRM_1739523138",
    "UF_CRM_1742294677003",
    "UF_CRM_1741079182998",
    "UF_CRM_1746464685417",
    "UF_CRM_1740391753843",
    "UF_CRM_1772658002",
    "UF_CRM_1760617147",
    "UF_CRM_1739527814",
    "UF_CRM_1739527830",
    "UF_CRM_1741078462909",
    "UF_CRM_1741078526352",
    "UF_CRM_1739525055",
    "UF_CRM_1739525147",
  ];

  const dealUts = byTable.get("b_uts_crm_deal");
  dealUts.selected_columns = [
    "VALUE_ID",
    "UF_CRM_1742469270280",
    "UF_CRM_1742550450292",
    "UF_CRM_1768909094",
    "UF_CRM_1753863368307",
    "UF_CRM_1774964823614",
    "UF_CRM_1753863405091",
    "UF_CRM_1753863435404",
    "UF_CRM_1760952900341",
    "UF_CRM_1760966132418",
    "UF_CRM_1760954707",
    "UF_CRM_1760954734989",
    "UF_CRM_1760955367445",
    "UF_CRM_1760955131",
    "UF_CRM_1760965805010",
    "UF_CRM_1772658211",
    "UF_CRM_1769425500",
    "UF_CRM_1771334896",
  ];

  byTable.get("b_crm_dynamic_items_1042").selected_columns = [
    "ID",
    "STAGE_ID",
    "COMPANY_ID",
    "CONTACT_ID",
    "ASSIGNED_BY_ID",
    "CREATED_BY",
    "UPDATED_BY",
    "CREATED_TIME",
    "UPDATED_TIME",
    "UF_CRM_4_1772366498",
    "UF_CRM_4_1772366586",
    "UF_CRM_4_1772366686",
    "UF_CRM_4_1772366729",
    "UF_CRM_4_1772693942281",
    "UF_CRM_4_1772694354360",
  ];

  const task = byTable.get("b_tasks");
  if (!task.selected_columns.includes("STAGE_ID")) task.selected_columns.push("STAGE_ID");
  task.selection_baseline_count = 62;
  task.selection_conflict_baseline_count = 27;
  task.classifier_id = "legacy-task-domain-v1";

  const selectionPredicates = {
    b_user_field: `ID IN (${CUSTOM_FIELD_IDS.join(", ")})`,
    b_user_field_lang:
      `LANGUAGE_ID = 'ru' AND USER_FIELD_ID IN (${CUSTOM_FIELD_IDS.join(", ")})`,
    b_user_field_enum:
      `USER_FIELD_ID IN (${Object.keys(ENUM_FIELD_COUNTS).join(", ")})`,
    b_crm_status:
      `ENTITY_ID IN (${Object.keys(STATUS_ENTITY_COUNTS)
        .map((value) => `'${value}'`)
        .join(", ")})`,
    b_crm_dynamic_type: "ENTITY_TYPE_ID = 1042",
    b_crm_item_category: "ENTITY_TYPE_ID = 1042 AND ID = 8",
    b_iblock: "ID IN (3, 21)",
    b_iblock_element: "IBLOCK_ID = 21",
    b_iblock_section: "IBLOCK_ID = 3",
  };
  byTable.get("b_iblock_section").selection_baseline_count = 5;
  for (const [sourceTable, predicate] of Object.entries(selectionPredicates)) {
    byTable.get(sourceTable).selection_predicate_sql = predicate;
  }

  const fieldDefinitionById = new Map(
    metadataRows.b_user_field.map((row) => [row.ID, row]),
  );
  const physicalMirrorColumnsByTable = Object.fromEntries(
    Object.keys(CRM_UF_PROFILE_TABLE_TOTALS).map((table) => [table, new Set()]),
  );
  for (const fieldId of MULTIVALUE_CANONICAL_FIELD_IDS) {
    const definition = fieldDefinitionById.get(fieldId);
    if (!definition) throw new Error(`Missing multi-value field definition: ${fieldId}`);
    const sourceTable = Object.entries(CRM_UF_ENTITY_IDS).find(
      ([, entityId]) => entityId === definition.ENTITY_ID,
    )?.[0];
    if (!sourceTable) {
      throw new Error(`Unsupported multi-value CRM field entity: ${fieldId}`);
    }
    physicalMirrorColumnsByTable[sourceTable].add(definition.FIELD_NAME);
  }

  let populatedQuarantineColumnCount = 0;
  let coveredMirrorColumnCount = 0;
  for (const sourceTable of Object.keys(CRM_UF_PROFILE_TABLE_TOTALS)) {
    const entity = byTable.get(sourceTable);
    const selected = new Set(entity.selected_columns);
    const rawProfile = rawCrmUfProfiles[sourceTable];
    if (!rawProfile) throw new Error(`CRM UF raw profile missing: ${sourceTable}`);
    entity.covered_mirror_columns = [...physicalMirrorColumnsByTable[sourceTable]].sort();
    for (const column of entity.covered_mirror_columns) {
      const counts = rawProfile.columns[column];
      if (!counts || counts.non_empty_count <= 0 || selected.has(column)) {
        throw new Error(
          `Invalid populated CRM UF multi-value mirror: ${sourceTable}.${column}`,
        );
      }
    }
    coveredMirrorColumnCount += entity.covered_mirror_columns.length;
    const mirrors = physicalMirrorColumnsByTable[sourceTable];
    entity.quarantine_columns = Object.entries(rawProfile.columns)
      .filter(
        ([column, counts]) =>
          !selected.has(column) &&
          !mirrors.has(column) &&
          counts.non_empty_count > 0,
      )
      .map(([column]) => column);
    if (entity.quarantine_columns.length) {
      entity.target = [
        ...new Set([
          ...(entity.target ?? []),
          "migration.unmapped_custom_field_quarantine",
        ]),
      ].sort();
    }
    populatedQuarantineColumnCount += entity.quarantine_columns.length;
  }
  if (coveredMirrorColumnCount !== 7 || populatedQuarantineColumnCount !== 63) {
    throw new Error(
      `Expected 7 covered CRM UF mirrors and 63 populated quarantine columns, found ${coveredMirrorColumnCount}/${populatedQuarantineColumnCount}`,
    );
  }

  const activity = byTable.get("b_crm_act");
  activity.selected_columns = activity.selected_columns.map((column) =>
    column === "RESP_ID" ? "RESPONSIBLE_ID" : column,
  );

  const activityBinding = byTable.get("b_crm_act_bind");
  activityBinding.primary_key = ["ID"];
  activityBinding.selected_columns = [
    "ID",
    "ACTIVITY_ID",
    "OWNER_ID",
    "OWNER_TYPE_ID",
  ];

  const event = byTable.get("b_crm_event");
  event.selected_columns = [
    "ID",
    "EVENT_ID",
    "EVENT_NAME",
    "DATE_CREATE",
    "CREATED_BY_ID",
    "EVENT_TEXT_1",
    "EVENT_TEXT_2",
    "EVENT_TYPE",
    "FILES",
  ];

  const entities = [...byTable.values()].sort((left, right) =>
    left.source_table.localeCompare(right.source_table),
  );

  for (const entity of entities) {
    const tableDefinition = schemaInventory.tables[entity.source_table];
    if (!tableDefinition) throw new Error(`Unknown manifest table: ${entity.source_table}`);
    if (tableDefinition.data.rows !== entity.baseline_count) {
      throw new Error(
        `Baseline mismatch ${entity.source_table}: ${entity.baseline_count} != ${tableDefinition.data.rows}`,
      );
    }
    entity.selected_columns = [...new Set(entity.selected_columns)];
    entity.excluded_columns = [...new Set(entity.excluded_columns ?? [])];
    entity.quarantine_columns = [...new Set(entity.quarantine_columns ?? [])];
    entity.covered_mirror_columns = [...new Set(entity.covered_mirror_columns ?? [])];
    const actualColumns = new Set(schemaColumns(schemaInventory, entity.source_table));
    for (const column of [
      ...entity.selected_columns,
      ...entity.excluded_columns,
      ...entity.quarantine_columns,
      ...entity.covered_mirror_columns,
    ]) {
      if (!actualColumns.has(column)) {
        throw new Error(`Unknown column ${entity.source_table}.${column}`);
      }
    }
    for (const column of entity.quarantine_columns) {
      if (
        entity.selected_columns.includes(column) ||
        entity.excluded_columns.includes(column)
      ) {
        throw new Error(
          `CRM UF quarantine column overlaps selected/excluded columns: ${entity.source_table}.${column}`,
        );
      }
    }
    for (const column of entity.covered_mirror_columns) {
      if (
        entity.selected_columns.includes(column) ||
        entity.excluded_columns.includes(column) ||
        entity.quarantine_columns.includes(column)
      ) {
        throw new Error(
          `CRM UF covered mirror overlaps another disposition: ${entity.source_table}.${column}`,
        );
      }
    }
    for (const column of entity.primary_key) {
      if (!entity.selected_columns.includes(column)) entity.selected_columns.unshift(column);
    }
    const selectedRows = entity.selection_baseline_count ?? entity.baseline_count;
    const conflictRows = entity.selection_conflict_baseline_count ?? 0;
    const excludedRows = entity.baseline_count - selectedRows - conflictRows;
    if (
      selectedRows < 0 ||
      conflictRows < 0 ||
      excludedRows < 0 ||
      selectedRows + excludedRows + conflictRows !== entity.baseline_count
    ) {
      throw new Error(`Invalid row classifier baseline: ${entity.source_table}`);
    }
    if (!entity.selection_predicate_sql && !entity.classifier_id) {
      if (selectedRows !== entity.baseline_count || conflictRows !== 0) {
        throw new Error(
          `Filtered source requires predicate or classifier: ${entity.source_table}`,
        );
      }
      entity.selection_predicate_sql = "1 = 1";
    }
    entity.selection_baseline_count = selectedRows;
    entity.selection_excluded_baseline_count = excludedRows;
    entity.selection_conflict_baseline_count = conflictRows;
    entity.classification_balance = {
      selected_rows: selectedRows,
      excluded_rows: excludedRows,
      conflict_rows: conflictRows,
      baseline_rows: entity.baseline_count,
      invariant: "selected_rows + excluded_rows + conflict_rows = baseline_rows",
    };
    entity.source_key = sourceKeyFor(entity, schemaInventory);
    entity.coverage_scope = "all_source_rows";
    entity.expected_row_outcomes = entity.baseline_count;
    entity.migration_query_id = canonicalQueryId(entity.source_table);
    entity.source_disposition ??= "include_row_ledger";
  }

  manifest.manifest_version = "1.1.0";
  manifest.global_rules = {
    ...manifest.global_rules,
    coverage_denominator: "all_rows_of_all_manifest_tables",
    coverage_denominator_rows: EXPECTED_ROW_OUTCOMES,
    ledger_source_tables: EXPECTED_MANIFEST_TABLES,
    included_source_tables: EXPECTED_INCLUDED_TABLES,
    quarantine_source_tables: EXPECTED_QUARANTINE_TABLES,
    every_manifest_row_requires_exactly_one_outcome: true,
    selection_is_a_row_classification_not_a_coverage_filter: true,
    schema_count_or_checksum_change_blocks_run: true,
  };
  manifest.row_outcome_contract = {
    contract_version: "row-outcome-v1",
    ledger_key_components: [
      "snapshot_sha256",
      "source_table",
      "canonical_json(source_key)",
      "transform_version",
    ],
    allowed_outcomes: [
      "migrated",
      "linked_existing",
      "excluded_with_reason",
      "conflict_recorded",
      "quarantined",
    ],
    cardinality: "exactly_one_current_outcome_per_ledger_key",
    coverage_numerator: "distinct ledger keys with an allowed outcome",
    coverage_denominator: EXPECTED_ROW_OUTCOMES,
    coverage_gate: "numerator_equals_denominator_and_duplicate_keys_equal_zero",
    cutover_blocking_outcomes: ["conflict_recorded", "quarantined"],
    excluded_row_requires_reason_code: true,
    attempts_and_revisions_are_append_only_audit_records: true,
  };
  manifest.file_migration_contract = {
    contract_version: "file-migration-v2",
    run_mode_required: true,
    modes: {
      FULL: {
        meaning:
          "metadata, binary payload, binding, checksum, storage ownership and effective ACL are present and verified in target storage on one freeze watermark",
        current_snapshot_status: "BLOCKED_MISSING_UPLOAD_SNAPSHOT",
        required_evidence: [
          "db_snapshot_id",
          "upload_snapshot_id",
          "freeze_watermark",
          "source_binary_checksum",
          "target_object_id",
          "target_binary_checksum",
          "binding_reconciliation",
          "acl_reconciliation",
          "malware_scan_result",
          "unknown_principal_count",
          "orphan_acl_object_count",
          "orphan_storage_count",
          "task_permission_crosswalk_version",
          "external_link_decision_reconciliation",
        ],
        cutover_allowed_without_binary_snapshot: false,
        scope_change_waiver_allowed: false,
        required_zero_metrics: [
          "missing_binary_count",
          "binding_mismatch_count",
          "acl_mismatch_count",
          "unknown_principal_count",
          "orphan_acl_object_count",
          "orphan_storage_count",
          "malware_blocking_count",
          "unknown_task_id_count",
          "unresolved_external_link_decision_count",
        ],
        common_snapshot_invariant:
          "db_snapshot_id and upload_snapshot_id are signed against the same freeze_watermark",
      },
      PARTIAL: {
        meaning:
          "metadata and available bindings/ACL evidence migrate; every missing binary or unresolved ACL is explicitly unavailable",
        current_snapshot_status: "AVAILABLE_REQUIRES_OWNER_APPROVAL",
        required_evidence: [
          "approved_scope_exception_id",
          "db_snapshot_id",
          "freeze_watermark",
          "metadata_reconciliation",
          "missing_binary_reason_code",
          "acl_exception_list",
          "user_visible_unavailable_state",
        ],
        metadata_never_counts_as_migrated_binary: true,
        only_status_after_any_file_waiver: "PARTIAL_MIGRATION_ACCEPTED",
      },
    },
    current_snapshot_capability: "PARTIAL_ONLY",
    sql_file_metadata_rows: 3941,
    source_binary_snapshot_present: false,
    full_claim_requires_100_percent: [
      "binary_reconciliation",
      "binding_reconciliation",
      "acl_reconciliation",
      "storage_reconciliation",
      "malware_scan",
    ],
    source_acl_tables: {
      b_disk_right: 284,
      b_disk_simple_right: 1276,
      b_disk_sharing: 8,
      b_disk_storage: 221,
    },
    unknown_principal_or_orphan_blocks_full: true,
    full_scope_change_escape: false,
  };
  manifest.file_acl_contract = {
    contract_version: "file-acl-v1",
    target_acl: "platform.attachment_acl",
    target_storage: "platform.attachment_storage",
    source_tables: {
      b_disk_right: 284,
      b_disk_simple_right: 1276,
      b_disk_sharing: 8,
      b_disk_storage: 221,
    },
    required_acl_fields: [
      "attachment_id",
      "principal_id",
      "principal_kind",
      "permission",
      "effect",
      "inherited_from_storage_id",
      "valid_from",
      "valid_to",
      "source_table",
      "source_key",
      "provenance",
    ],
    required_storage_fields: [
      "storage_id",
      "owner_principal_id",
      "owner_principal_kind",
      "root_attachment_id",
      "uses_internal_rights",
      "source_table",
      "source_key",
      "provenance",
    ],
    principal_resolution: {
      classifier_id: "disk-acl-principal-v1",
      allowed_principal_kinds: [
        "user_account",
        "employee_profile",
        "organization_unit",
        "group",
        "system_connector",
        "public_link",
      ],
      unknown_principal_outcome: "conflict_recorded",
      unknown_principal_blocks_full: true,
    },
    orphan_object_or_storage_outcome: "conflict_recorded",
    orphan_object_or_storage_blocks_full: true,
    acl_reconciliation_cardinality:
      "every source ACL/share row has exactly one target ACL or signed conflict outcome",
    public_acl_default: "deny",
    permission_decode: {
      source_column: "b_disk_right.TASK_ID",
      strategy: "versioned_owner_approved_crosswalk",
      numeric_task_id_copy_forbidden: true,
      current_status: "BLOCKED_MISSING_APPROVED_TASK_PERMISSION_CROSSWALK",
      unresolved_task_id_outcome: "conflict_recorded",
      unresolved_task_id_blocks_full: true,
      required_evidence: [
        "task_permission_crosswalk_version",
        "decoded_acl_row_count",
        "unknown_task_id_count",
      ],
      unknown_task_id_count_required: 0,
    },
    legacy_external_link_contract: {
      source_table: "b_disk_external_link",
      baseline_rows: 2,
      legacy_secret_columns: ["HASH", "PASSWORD", "SALT"],
      legacy_secret_import_forbidden: true,
      allowed_outcomes: [
        "revoked_not_migrated",
        "reissued_with_new_target_secret",
        "excluded_with_signed_security_decision",
      ],
      unresolved_decision_count_required: 0,
      unresolved_blocks_full: true,
      raw_secret_or_url_in_artifacts_forbidden: true,
    },
  };
  manifest.custom_field_quarantine_contract = {
    contract_version: "crm-uf-quarantine-v1",
    target: "migration.unmapped_custom_field_quarantine",
    populated_physical_columns_without_direct_mapping: 70,
    approved_serialized_mirrors_excluded: 7,
    populated_unmapped_physical_columns_quarantined: 63,
    decision_owner: "migration_data_owner",
    decision_status: "pending",
    allowed_owner_decisions: ["map_to_canonical_target", "exclude_with_signed_reason"],
    field_ledger_key_components: [
      "snapshot_sha256",
      "source_table",
      "canonical_json(source_key)",
      "source_column",
      "transform_version",
    ],
    raw_value_storage:
      "restricted encrypted quarantine only; never generated artifacts, stdout, logs or reconciliation samples",
    column_name_and_aggregate_counts_only_in_generated_artifacts: true,
    approved_mirror_basis: {
      field_ids: MULTIVALUE_CANONICAL_FIELD_IDS,
      canonical_source: "b_utm_*",
      reason_code: "serialized_multi_value_mirror_excluded_canonical_source_b_utm",
      reference: "source-field-map.json#/common_rules",
    },
    pending_decision_blocks_cutover: true,
    row_ledger_semantics:
      "field quarantine is a sidecar outcome and does not create a second row-level migration outcome",
  };
  manifest.inactive_owner_resolution_contract = {
    contract_version: "inactive-operational-owner-v1",
    classifier_id: "inactive-operational-owner-v1",
    baseline: INACTIVE_OWNER_BASELINE,
    source_role: "current_operational_owner",
    historical_legacy_owner_is_immutable: true,
    required_per_record_fields: [
      "source_table",
      "source_key",
      "source_owner_id",
      "legacy_actor_id",
      "decision_id",
      "decision_outcome",
      "new_operational_owner_id",
      "rule_version",
      "decided_by",
      "decided_at",
      "signature",
    ],
    allowed_decision_outcomes: [
      "signed_manual_reassignment",
      "signed_versioned_rule_reassignment",
    ],
    signature_contract: {
      algorithm: "Ed25519",
      signed_payload:
        "canonical_json(source_table, source_key, source_owner_id, decision_outcome, new_operational_owner_id, rule_version, decided_by, decided_at)",
    },
    unresolved_required: 0,
    silent_fallback_forbidden: true,
  };
  manifest.legacy_task_domain_contract = {
    contract_version: "legacy-task-domain-v1",
    classifier_id: "legacy-task-domain-v1",
    baseline: {
      crm_only: 39,
      project_only: 23,
      dual_use_review: 21,
      neither_review: 6,
      total: 89,
    },
    direct_selected_rows: 62,
    conflict_rows_requiring_signed_decision: 27,
    dependent_sources_inherit_task_domain: [
      "b_tasks_member",
      "b_tasks_log",
      "b_tasks_task_dep",
      "b_tasks_task_stage",
      "b_tasks_result",
    ],
    allowed_target_domains: ["crm", "project"],
    unresolved_domain_outcome: "conflict_recorded",
    task_domain_decision_required_before_dependent_target_write: true,
  };
  manifest.crm_stage_history_contract = {
    contract_version: "crm-stage-history-v1",
    case_history: {
      source_table: "b_crm_deal_stage_history",
      baseline_rows: 4619,
      mapped_rows: 3932,
      conflict_rows: 687,
      classifier_id: "crm-case-stage-history-category-stage-v1",
      target: "crm.case_stage_history",
      interval_rule: "START_DATE <= END_DATE for every mapped row",
    },
    employer_referral_history: {
      source_table: "b_crm_entity_stage_history",
      baseline_rows: 3201,
      owner_type_id: 1042,
      category_id: 8,
      mapped_rows: 3201,
      conflict_rows: 0,
      target: "crm.employer_referral_stage_history",
    },
    supposed_sources: {
      b_crm_deal_stage_history_with_supposed: 9399,
      b_crm_entity_stage_history_with_supposed: 4271,
      required_outcome: "quarantined",
      canonical_history_write_allowed: false,
    },
  };
  manifest.task_source_stage_contract = {
    contract_version: "legacy-task-source-stage-v1",
    task_stage_id: {
      source_column: "b_tasks.STAGE_ID",
      total_rows: 89,
      zero_sentinel_rows: 73,
      nonzero_rows: 16,
      distinct_nonzero_stage_ids: 6,
      invalid_stage_references: 0,
      directly_classified_project_nonzero_rows: 15,
      unresolved_task_domain_nonzero_rows: 1,
      canonical_status_inference_forbidden: true,
    },
    definitions: {
      source_table: "b_tasks_stages",
      total_rows: 89,
      referenced_rows: 18,
      unreferenced_rows: 71,
      target: "migration.source_task_stage_definition",
      canonical_workflow_write_requires_signed_stage_map: true,
    },
    memberships: {
      source_table: "b_tasks_task_stage",
      total_rows: 174,
      current_task_references: 168,
      missing_current_task_references: 6,
      valid_stage_references: 174,
      target: "migration.source_task_stage_membership",
      temporal_period_inference_forbidden: true,
    },
  };
  manifest.task_history_contract = {
    contract_version: "legacy-task-history-v1",
    source_table: "b_tasks_log",
    baseline_rows: 629,
    directly_classified_rows: 399,
    conflict_rows: 230,
    missing_user_reference_rows: 9,
    missing_user_reference_semantics:
      "system_connector for UF_CRM_TASK_ADDED/DELETED events; never invent employee identity",
    targets_by_task_domain: {
      crm: "crm.task_history",
      project: "project.task_history",
    },
  };
  manifest.semantic_fingerprint_contract = {
    contract_version: "keyed-semantic-fingerprint-v1",
    algorithm: "HMAC-SHA-256",
    digest_encoding: "base64url",
    required_context_fields: ["purpose", "key_version"],
    key_storage: "external_secret_manager",
    different_purposes_use_domain_separated_keys: true,
    raw_input_forbidden_in: [
      "migration_ledger",
      "generated_artifacts",
      "stdout",
      "logs",
      "metrics",
      "reconciliation_samples",
    ],
    unkeyed_hash_for_personal_identifier_forbidden: true,
  };
  manifest.consent_snapshot_contract = {
    contract_version: "legacy-consent-snapshot-v1",
    target: "crm.consent_snapshot",
    source_binding: {
      table: "b_uts_crm_contact",
      column: "UF_CRM_1746464685417",
      source_field_id: 206,
    },
    required_fields: [
      "subject_id",
      "consent_kind",
      "legacy_boolean_value",
      "legacy_source_field",
      "policy_version",
      "captured_at",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: {
      policy_version: "null_or_unknown",
      captured_at: "null_unless_source_proves_timestamp",
      modern_consent_must_not_be_inferred: true,
      legacy_boolean_is_snapshot_not_current_authorization: true,
    },
  };
  manifest.actor_assignment_contract = {
    contract_version: "perioded-actor-assignment-v1",
    required_fields: [
      "subject_id",
      "actor_id",
      "actor_kind",
      "role",
      "valid_from",
      "valid_to",
      "source_table",
      "source_key",
      "provenance",
    ],
    actor_kind_values: [
      "employee_profile",
      "legacy_actor",
      "system_connector",
      "bot",
      "anonymous_actor",
    ],
    historical_actor_semantics: {
      roles: ["creator", "modifier", "originator"],
      mutable: false,
      inactive_actor_is_preserved: true,
      reassignment_does_not_rewrite_history: true,
      valid_from: "source event or entity creation timestamp",
      valid_to: "null unless the source explicitly periods the historical role",
    },
    operational_owner_semantics: {
      roles: ["owner", "responsible", "co_executor"],
      mutable: true,
      current_relation_has_null_valid_to: true,
      reassignment_closes_previous_relation_at_valid_to: true,
      active_employee_required_for_new_assignment: true,
      unresolved_or_ineligible_actor_outcome: "conflict_recorded",
    },
    source_actor_resolution:
      "source user is always preserved as identity.legacy_actor; eligible staff may additionally resolve to identity.employee_profile",
  };
  manifest.legacy_relation_type_maps = {
    "b_tasks_member.TYPE": {
      source_table: "b_tasks_member",
      source_column: "TYPE",
      task_domain_contract_ref: "migration-scope-manifest.json#/legacy_task_domain_contract",
      target_relation_by_task_domain: {
        crm: "crm.task_assignment",
        project: "project.task_assignment",
      },
      mappings: {
        A: {
          role: "co_executor",
          baseline_count: 9,
          actor_semantics: "operational_owner",
          target_relation_by_task_domain: {
            crm: "crm.task_assignment",
            project: "project.task_assignment",
          },
          unresolved_task_domain_outcome: "conflict_recorded",
        },
        O: {
          role: "originator",
          baseline_count: 89,
          actor_semantics: "historical_actor",
          target_relation_by_task_domain: {
            crm: "crm.task_assignment",
            project: "project.task_assignment",
          },
          unresolved_task_domain_outcome: "conflict_recorded",
        },
        R: {
          role: "responsible",
          baseline_count: 89,
          actor_semantics: "operational_owner",
          target_relation_by_task_domain: {
            crm: "crm.task_assignment",
            project: "project.task_assignment",
          },
          unresolved_task_domain_outcome: "conflict_recorded",
        },
      },
      unknown: {
        baseline_count: 0,
        outcome: "conflict_recorded",
        blocking: true,
      },
      baseline_total: 187,
    },
  };
  manifest.blocking_reconciliation = {
    ...manifest.blocking_reconciliation,
    manifest_source_tables: EXPECTED_MANIFEST_TABLES,
    included_source_tables: EXPECTED_INCLUDED_TABLES,
    quarantine_source_tables: EXPECTED_QUARANTINE_TABLES,
    source_row_outcomes: EXPECTED_ROW_OUTCOMES,
    custom_field_definitions_selected: 46,
    enum_values_selected: 143,
    crm_status_definitions_selected: 96,
    settlement_dictionary_rows: 61,
    settlement_field_values: 701,
    settlement_distinct_used: 29,
    invalid_settlement_references: 0,
    department_units: 5,
    department_head_assignments: 5,
    invalid_department_head_references: 0,
    populated_crm_uf_serialized_mirrors_excluded: 7,
    populated_unmapped_crm_uf_columns_quarantined: 63,
    crm_case_stage_history_rows: 4619,
    crm_case_supposed_stage_history_quarantine_rows: 9399,
    crm_typed_entity_stage_history_rows: 3201,
    crm_entity_supposed_stage_history_quarantine_rows: 4271,
    crm_observer_relations: 90,
    task_history_rows: 629,
    task_dependency_source_rows: 4,
    task_dependency_reflexive_closure_excluded: 3,
    task_dependency_domain_conflicts: 1,
    task_stage_definition_source_rows: 89,
    task_stage_definition_referenced_rows: 18,
    task_stage_membership_evidence_rows: 174,
    task_result_rows: 3,
    file_acl_rows: 1568,
    file_storage_rows: 221,
    inactive_owner_decisions_required: INACTIVE_OWNER_BASELINE.total,
    inactive_owner_unresolved_required: INACTIVE_OWNER_BASELINE.unresolved,
  };
  manifest.entities = entities;

  if (entities.length !== EXPECTED_MANIFEST_TABLES) {
    throw new Error(`Expected ${EXPECTED_MANIFEST_TABLES} manifest tables, found ${entities.length}`);
  }
  const denominator = entities.reduce((total, entity) => total + entity.baseline_count, 0);
  if (denominator !== EXPECTED_ROW_OUTCOMES) {
    throw new Error(`Expected denominator ${EXPECTED_ROW_OUTCOMES}, found ${denominator}`);
  }
  const includedCount = entities.filter(
    (entity) => entity.source_disposition === "include_row_ledger",
  ).length;
  const quarantineCount = entities.filter(
    (entity) => entity.source_disposition === "quarantine_only",
  ).length;
  if (
    includedCount !== EXPECTED_INCLUDED_TABLES ||
    quarantineCount !== EXPECTED_QUARANTINE_TABLES
  ) {
    throw new Error(
      `Expected ${EXPECTED_INCLUDED_TABLES} included and ${EXPECTED_QUARANTINE_TABLES} quarantine tables, found ${includedCount}/${quarantineCount}`,
    );
  }
  return manifest;
}

function normalizeSourceFieldMap(sourceFieldMap, metadataRows) {
  const fieldDefinitions = new Map(metadataRows.b_user_field.map((row) => [row.ID, row]));
  const russianLabels = new Map(
    metadataRows.b_user_field_lang
      .filter((row) => row.LANGUAGE_ID === "ru")
      .map((row) => [row.USER_FIELD_ID, row.EDIT_FORM_LABEL]),
  );

  const selectedDefinitions = CUSTOM_FIELD_IDS.map((id) => {
    const definition = fieldDefinitions.get(id);
    if (!definition) throw new Error(`Missing b_user_field definition ${id}`);
    const sourceLabel = russianLabels.get(id);
    if (!sourceLabel) throw new Error(`Missing Russian label for b_user_field ${id}`);
    return {
      id,
      entity_id: definition.ENTITY_ID,
      field_name: definition.FIELD_NAME,
      user_type_id: definition.USER_TYPE_ID,
      multiple: definition.MULTIPLE,
      mandatory: definition.MANDATORY,
      source_label_ru: sourceLabel,
    };
  });

  const enumRowsByField = new Map();
  for (const row of metadataRows.b_user_field_enum) {
    if (!(row.USER_FIELD_ID in ENUM_FIELD_COUNTS)) continue;
    if (!enumRowsByField.has(row.USER_FIELD_ID)) enumRowsByField.set(row.USER_FIELD_ID, []);
    enumRowsByField.get(row.USER_FIELD_ID).push(row);
  }

  for (const [fieldIdText, expectedCount] of Object.entries(ENUM_FIELD_COUNTS)) {
    const fieldId = Number(fieldIdText);
    const rows = (enumRowsByField.get(fieldId) ?? []).sort((left, right) => left.ID - right.ID);
    if (rows.length !== expectedCount) {
      throw new Error(`Enum field ${fieldId}: expected ${expectedCount}, found ${rows.length}`);
    }
    const definition = fieldDefinitions.get(fieldId);
    sourceFieldMap.enum_maps[`${definition.FIELD_NAME}/field_${fieldId}`] = Object.fromEntries(
      rows.map((row) => [String(row.ID), row.VALUE]),
    );
  }

  const statusesByEntityAndCode = new Map(
    metadataRows.b_crm_status.map((row) => [`${row.ENTITY_ID}\0${row.STATUS_ID}`, row]),
  );
  for (const [stageGroup, entityId] of Object.entries(STAGE_GROUP_TO_ENTITY)) {
    for (const stage of sourceFieldMap.stages[stageGroup] ?? []) {
      const source = statusesByEntityAndCode.get(`${entityId}\0${stage.code}`);
      if (!source) throw new Error(`Missing status definition ${entityId}/${stage.code}`);
      stage.label = source.NAME;
      stage.semantics = source.SEMANTICS;
      stage.source_status_id = source.ID;
      stage.source_category_id = source.CATEGORY_ID;
    }
  }

  for (const section of ["contact_fields", "deal_fields", "dynamic_1042_fields"]) {
    for (const field of sourceFieldMap[section]) {
      if (field.id === null) continue;
      field.source_label = russianLabels.get(field.id);
    }
  }

  sourceFieldMap.map_version = "1.1.0";
  sourceFieldMap.metadata_bindings = {
    custom_fields: {
      definition_source_table: "b_user_field",
      definition_ids: CUSTOM_FIELD_IDS,
      definition_selected_count: 46,
      definitions: selectedDefinitions,
      label_source_table: "b_user_field_lang",
      label_language_id: "ru",
      label_selected_count: 46,
      enum_source_table: "b_user_field_enum",
      enum_field_counts: ENUM_FIELD_COUNTS,
      enum_selected_count: 143,
    },
    crm_status: {
      source_table: "b_crm_status",
      entity_counts: STATUS_ENTITY_COUNTS,
      selected_count: 96,
      field_bindings: [
        { source: "b_crm_contact.TYPE_ID", entity_id: "CONTACT_TYPE" },
        { source: "b_crm_contact.SOURCE_ID", entity_id: "SOURCE" },
        { source: "b_crm_company.COMPANY_TYPE", entity_id: "COMPANY_TYPE" },
        { source: "b_crm_deal.SOURCE_ID", entity_id: "SOURCE" },
        { source: "b_crm_event.EVENT_TYPE", entity_id: "EVENT_TYPE" },
        {
          source: "b_crm_deal.STAGE_ID",
          entity_id_by_category: DEAL_STAGE_ENTITY_BY_CATEGORY,
        },
        {
          source: "b_crm_dynamic_items_1042.STAGE_ID",
          entity_id: "DYNAMIC_1042_STAGE_8",
        },
      ],
    },
    deal_categories: {
      source_table: "b_crm_deal_category",
      explicit_source_ids: [1, 2, 3, 5],
      explicit_source_count: 4,
      implicit_default: {
        id: 0,
        source_kind: "implicit_default",
        evidence:
          "b_crm_deal.CATEGORY_ID=0 plus b_crm_status rows with ENTITY_ID=DEAL_STAGE",
        source_table_row_present: false,
      },
    },
    dynamic_1042: {
      type_source: {
        table: "b_crm_dynamic_type",
        entity_type_id: 1042,
        expected_count: 1,
      },
      category_source: {
        table: "b_crm_item_category",
        entity_type_id: 1042,
        category_id: 8,
        expected_count: 1,
      },
    },
    organization: {
      iblock_source: { table: "b_iblock", id: 3, expected_count: 1 },
      unit_source: { table: "b_iblock_section", iblock_id: 3, expected_count: 5 },
      membership_source: {
        table: "b_utm_user",
        field_id: 40,
        expected_count: 29,
        employee_count: 20,
        missing_unit_ids: [2],
      },
      head_source: {
        table: "b_uts_iblock_3_section",
        field: "UF_HEAD",
        expected_count: 5,
        invalid_references: 0,
      },
    },
    settlement: {
      field_id: 310,
      iblock_source: { table: "b_iblock", id: 21, expected_count: 1 },
      dictionary_source: {
        table: "b_iblock_element",
        predicate: "IBLOCK_ID=21",
        expected_count: 61,
      },
      usage: {
        source: "b_uts_crm_deal.UF_CRM_1768909094",
        nonempty_values: 701,
        distinct_ids: 29,
        invalid_references: 0,
      },
    },
  };
  return sourceFieldMap;
}

function buildMigrationQueryRegistry(manifest, requirementRows) {
  const sourceExtractQueries = manifest.entities.map((entity) => {
    const extractionColumns = [
      ...new Set([
        ...entity.selected_columns,
        ...(entity.quarantine_columns ?? []),
      ]),
    ];
    const selected = extractionColumns.map(quoteIdentifier).join(", ");
    const order = entity.source_key.columns.map(quoteIdentifier).join(", ");
    const extractionSql = `SELECT ${selected} FROM ${quoteIdentifier(entity.source_table)} ORDER BY ${order}`;
    const countSql = `SELECT COUNT(*) AS source_rows FROM ${quoteIdentifier(entity.source_table)}`;
    const hasPredicate = Boolean(entity.selection_predicate_sql);
    const hasClassifier = Boolean(entity.classifier_id);
    if (hasPredicate === hasClassifier) {
      throw new Error(
        `${entity.source_table} source query must have exactly one predicate or classifier`,
      );
    }
    const classificationCountSql = hasPredicate
      ? `SELECT SUM(CASE WHEN ${entity.selection_predicate_sql} THEN 1 ELSE 0 END) AS selected_rows, SUM(CASE WHEN ${entity.selection_predicate_sql} THEN 0 ELSE 1 END) AS excluded_rows, 0 AS conflict_rows, COUNT(*) AS baseline_rows FROM ${quoteIdentifier(entity.source_table)}`
      : undefined;
    return {
      query_id: entity.migration_query_id,
      query_kind: "source_extract",
      result_type: "rowset",
      source_table: entity.source_table,
      coverage_scope: "all_source_rows",
      expected_source_rows: entity.baseline_count,
      expected_row_outcomes: entity.expected_row_outcomes,
      source_key: entity.source_key,
      canonical_selected_columns: entity.selected_columns,
      quarantine_columns: entity.quarantine_columns ?? [],
      extraction_columns: extractionColumns,
      classification_rule: entity.inclusion_rule,
      ...(hasPredicate
        ? {
            selection_predicate_sql: entity.selection_predicate_sql,
            classification_count_sql: classificationCountSql,
            classification_count_sql_sha256: sha256(classificationCountSql),
          }
        : {
            classifier_id: entity.classifier_id,
            classifier_executor_id: `migration.classifier.${entity.classifier_id}`,
          }),
      expected_selected_rows: entity.selection_baseline_count,
      expected_excluded_rows: entity.selection_excluded_baseline_count,
      expected_conflict_rows: entity.selection_conflict_baseline_count,
      classification_balance: entity.classification_balance,
      source_disposition: entity.source_disposition,
      ...(entity.required_row_outcome
        ? { required_row_outcome: entity.required_row_outcome }
        : {}),
      transform_version: entity.transform_version,
      expected_rule: {
        operator: "row_count_equals",
        value: entity.baseline_count,
        blocking: true,
      },
      count_sql: countSql,
      extraction_sql: extractionSql,
      extraction_sql_sha256: sha256(extractionSql),
    };
  });

  const classifierRegistry = [...new Set(
    sourceExtractQueries
      .map((query) => query.classifier_id)
      .filter(Boolean),
  )]
    .sort()
    .map((classifierId) => ({
      classifier_id: classifierId,
      version: classifierId.match(/-v(\d+)$/)?.[1] ?? "1",
      executor_id: `migration.classifier.${classifierId}`,
      input_contract: "source row plus referenced source keys from the pinned snapshot",
      output_contract: {
        required_fields: ["source_key", "outcome", "reason_code", "classifier_version"],
        allowed_outcomes: ["selected", "excluded", "conflict"],
      },
      deterministic: true,
      value_logging: false,
      source_tables: sourceExtractQueries
        .filter((query) => query.classifier_id === classifierId)
        .map((query) => query.source_table)
        .sort(),
    }));

  const headers = requirementRows[0] ?? [];
  const requirementIdIndex = headers.indexOf("requirement_id");
  const migrationQueryIndex = headers.indexOf("migration_query");
  if (requirementIdIndex < 0 || migrationQueryIndex < 0) {
    throw new Error("Requirements crosswalk lacks requirement_id or migration_query");
  }
  const requirementsByQuery = new Map();
  for (const row of requirementRows.slice(1)) {
    const ids = (row[migrationQueryIndex] ?? "")
      .split("|")
      .map((value) => value.trim())
      .filter((value) => value.startsWith("MIG-Q-"));
    for (const queryId of ids) {
      if (!requirementsByQuery.has(queryId)) requirementsByQuery.set(queryId, new Set());
      requirementsByQuery.get(queryId).add(row[requirementIdIndex]);
    }
  }
  if (requirementsByQuery.size !== EXPECTED_REQUIREMENT_QUERIES) {
    throw new Error(
      `Expected ${EXPECTED_REQUIREMENT_QUERIES} requirement query IDs, found ${requirementsByQuery.size}`,
    );
  }

  const requirementQueries = [...requirementsByQuery.entries()]
    .map(([queryId, requirementIds]) => {
      const definition = requirementQueryDefinitions[queryId];
      if (!definition) throw new Error(`Missing typed requirement query definition: ${queryId}`);
      return {
        query_id: queryId,
        ...definition,
        requirement_ids: [...requirementIds].sort(),
      };
    })
    .sort((left, right) => left.query_id.localeCompare(right.query_id));
  const unusedDefinitions = Object.keys(requirementQueryDefinitions).filter(
    (queryId) => !requirementsByQuery.has(queryId),
  );
  if (unusedDefinitions.length) {
    throw new Error(`Unused requirement query definitions: ${unusedDefinitions.join(", ")}`);
  }

  const queries = [...sourceExtractQueries, ...requirementQueries];
  return {
    registry_version: "1.0.0",
    snapshot_sha256: SNAPSHOT_SHA256,
    coverage_denominator: EXPECTED_ROW_OUTCOMES,
    source_extract_query_count: sourceExtractQueries.length,
    requirement_evidence_query_count: requirementQueries.length,
    classifier_count: classifierRegistry.length,
    classifier_registry: classifierRegistry,
    query_count: queries.length,
    queries,
  };
}

function canonicalSourceFieldTarget(field) {
  const alias = String(field.target ?? "").split(".")[0];
  const canonicalId = SOURCE_FIELD_TARGET_ALIASES[alias];
  if (!canonicalId) {
    throw new Error(`Unknown source-field target alias: ${field.target}`);
  }
  return canonicalId;
}

function addSourceFieldTargetsToManifest(manifest, sourceFieldMap) {
  const manifestByTable = new Map(
    manifest.entities.map((entity) => [entity.source_table, entity]),
  );
  for (const section of ["contact_fields", "deal_fields", "dynamic_1042_fields"]) {
    for (const field of sourceFieldMap[section]) {
      const match = String(field.source ?? "").match(
        /^(b_uts_crm_contact|b_uts_crm_deal|b_crm_dynamic_items_1042)\.(UF_[A-Z0-9_]+)$/,
      );
      if (!match) continue;
      const entity = manifestByTable.get(match[1]);
      if (!entity) {
        throw new Error(`Source-field table absent from migration manifest: ${match[1]}`);
      }
      entity.target = [
        ...new Set([...(entity.target ?? []), canonicalSourceFieldTarget(field)]),
      ].sort();
    }
  }
}

function buildColumnDispositionManifest(
  manifest,
  schemaInventory,
  rawCrmUfProfiles,
  sourceFieldMap,
  metadataRows,
) {
  const manifestByTable = new Map(manifest.entities.map((entity) => [entity.source_table, entity]));
  const sourceFieldBindings = new Map();
  const sourceFieldsById = new Map();
  for (const section of ["contact_fields", "deal_fields", "dynamic_1042_fields"]) {
    for (const field of sourceFieldMap[section]) {
      sourceFieldsById.set(field.id, { ...field, section });
      const match = field.source.match(
        /^(b_uts_crm_contact|b_uts_crm_deal|b_crm_dynamic_items_1042)\.(UF_[A-Z0-9_]+)$/,
      );
      if (!match) continue;
      const key = `${match[1]}.${match[2]}`;
      if (sourceFieldBindings.has(key)) {
        throw new Error(`Duplicate physical CRM UF binding: ${key}`);
      }
      sourceFieldBindings.set(key, {
        canonical_target_id: canonicalSourceFieldTarget(field),
        binding: {
          section,
          field_id: field.id,
          source: field.source,
          source_label: field.source_label ?? field.label,
          target: field.target,
          type: field.type,
        },
      });
    }
  }

  const fieldMetadataByPhysicalColumn = new Map();
  for (const definition of metadataRows.b_user_field) {
    const sourceTable = Object.entries(CRM_UF_ENTITY_IDS).find(
      ([, entityId]) => entityId === definition.ENTITY_ID,
    )?.[0];
    if (!sourceTable || !String(definition.FIELD_NAME).startsWith("UF_")) continue;
    const key = `${sourceTable}.${definition.FIELD_NAME}`;
    if (fieldMetadataByPhysicalColumn.has(key)) {
      throw new Error(`Duplicate CRM UF source metadata: ${key}`);
    }
    fieldMetadataByPhysicalColumn.set(key, {
      definition_id: definition.ID,
      entity_id: definition.ENTITY_ID,
      field_name: definition.FIELD_NAME,
      user_type_id: definition.USER_TYPE_ID,
      multiple: definition.MULTIPLE,
      mandatory: definition.MANDATORY,
    });
  }

  const physicalMirrorBindings = new Map();
  for (const fieldId of MULTIVALUE_CANONICAL_FIELD_IDS) {
    const field = sourceFieldsById.get(fieldId);
    const definition = metadataRows.b_user_field.find((row) => row.ID === fieldId);
    if (
      !field ||
      !definition ||
      definition.MULTIPLE !== "Y" ||
      !/^b_utm_crm_(contact|deal)\.FIELD_ID=\d+\.(VALUE|VALUE_INT|VALUE_DATE)$/.test(
        String(field.source),
      )
    ) {
      throw new Error(`Invalid canonical b_utm mirror binding for field ${fieldId}`);
    }
    const sourceTable = Object.entries(CRM_UF_ENTITY_IDS).find(
      ([, entityId]) => entityId === definition.ENTITY_ID,
    )?.[0];
    const key = `${sourceTable}.${definition.FIELD_NAME}`;
    physicalMirrorBindings.set(key, {
      canonical_target_id: canonicalSourceFieldTarget(field),
      canonical_source_binding: {
        section: field.section,
        field_id: field.id,
        physical_mirror_source: key,
        canonical_source: field.source,
        target: field.target,
        type: field.type,
      },
    });
  }

  const tables = manifest.entities.map((entity) => {
    const selected = new Set(entity.selected_columns);
    const excluded = new Set(entity.excluded_columns ?? []);
    const quarantined = new Set(entity.quarantine_columns ?? []);
    const coveredMirrors = new Set(entity.covered_mirror_columns ?? []);
    const sourceKey = new Set(entity.source_key.columns);
    const columns = schemaInventory.tables[entity.source_table].columns.map((column) => {
      let disposition;
      let semanticDisposition;
      let reasonCode;
      let semanticEvidence = {};
      if (selected.has(column.name)) {
        disposition = "selected";
        if (sourceKey.has(column.name)) {
          semanticDisposition = "provenance_only";
          reasonCode = "stable_source_row_identity";
          semanticEvidence = {
            provenance_reason:
              "required for canonical source key, idempotency, reconciliation and source traceability",
          };
        } else {
          semanticDisposition = "mapped";
          reasonCode = column.sensitive_classes.length
            ? "mapped_protected_business_data"
            : "mapped_to_canonical_target";
          const sourceFieldBinding = sourceFieldBindings.get(
            `${entity.source_table}.${column.name}`,
          );
          semanticEvidence = {
            target_ids: sourceFieldBinding
              ? [
                  ...new Set([
                    sourceFieldBinding.canonical_target_id,
                    "migration.provenance",
                  ]),
                ].sort()
              : entity.target,
          };
        }
      } else if (coveredMirrors.has(column.name)) {
        const mirrorBinding = physicalMirrorBindings.get(
          `${entity.source_table}.${column.name}`,
        );
        if (!mirrorBinding) {
          throw new Error(
            `CRM UF covered mirror lacks canonical b_utm binding: ${entity.source_table}.${column.name}`,
          );
        }
        disposition = "excluded";
        semanticDisposition = "excluded";
        reasonCode = "serialized_multi_value_mirror_excluded_canonical_source_b_utm";
        semanticEvidence = {
          approved_basis: "source-field-map.json#/common_rules",
          decision_owner: "migration_data_owner",
          decision_status: "approved_canonical_b_utm_source",
          cutover_blocking: false,
          target_ids: [
            mirrorBinding.canonical_target_id,
            "migration.provenance",
          ].sort(),
          canonical_source_binding: mirrorBinding.canonical_source_binding,
        };
      } else if (quarantined.has(column.name)) {
        const fieldMetadata = fieldMetadataByPhysicalColumn.get(
          `${entity.source_table}.${column.name}`,
        );
        if (!fieldMetadata) {
          throw new Error(
            `Populated CRM UF quarantine lacks source metadata: ${entity.source_table}.${column.name}`,
          );
        }
        disposition = "quarantined";
        semanticDisposition = "quarantined";
        reasonCode =
          `populated_unmapped_crm_uf_field_${fieldMetadata.definition_id}_pending_owner_decision`;
        semanticEvidence = {
          reason_detail:
            `${entity.source_table}.${column.name} is populated and has source field ` +
            `${fieldMetadata.definition_id} (${fieldMetadata.user_type_id}, multiple=${fieldMetadata.multiple}, mandatory=${fieldMetadata.mandatory}) ` +
            "but no approved canonical mapping; preserve only in restricted field quarantine pending migration_data_owner decision",
          source_field_metadata: fieldMetadata,
          target_ids: ["migration.unmapped_custom_field_quarantine"],
          decision_owner: "migration_data_owner",
          decision_status: "pending",
          cutover_blocking: true,
        };
      } else if (excluded.has(column.name)) {
        disposition = "excluded";
        semanticDisposition = "excluded";
        reasonCode = "explicit_sensitive_or_secret_exclusion";
      } else {
        disposition = "excluded";
        semanticDisposition = "excluded";
        const crmUfCounts =
          rawCrmUfProfiles[entity.source_table]?.columns?.[column.name];
        reasonCode = crmUfCounts && crmUfCounts.non_empty_count === 0
          ? "empty_physical_uf_not_selected_by_versioned_mapping"
          : "not_selected_by_versioned_mapping";
      }
      return {
        column: column.name,
        disposition,
        semantic_disposition: semanticDisposition,
        reason_code: reasonCode,
        ...semanticEvidence,
        sensitive_classes: column.sensitive_classes,
      };
    });
    return {
      source_table: entity.source_table,
      baseline_count: entity.baseline_count,
      migration_query_id: entity.migration_query_id,
      source_key: entity.source_key,
      columns,
    };
  });

  const crmUfValueProfiles = [];
  for (const [sourceTable, expectedRows] of Object.entries(CRM_UF_PROFILE_TABLE_TOTALS)) {
    const entity = manifestByTable.get(sourceTable);
    if (!entity) throw new Error(`CRM UF profile table absent from manifest: ${sourceTable}`);
    const selected = new Set(entity.selected_columns);
    const quarantined = new Set(entity.quarantine_columns ?? []);
    const coveredMirrors = new Set(entity.covered_mirror_columns ?? []);
    const rawTableProfile = rawCrmUfProfiles[sourceTable];
    if (!rawTableProfile || rawTableProfile.total_rows !== expectedRows) {
      throw new Error(`CRM UF table profile total mismatch: ${sourceTable}`);
    }
    const physicalUfColumns = schemaInventory.tables[sourceTable].columns
      .map((column) => column.name)
      .filter((column) => column.startsWith("UF_"));
    const profiledColumns = Object.keys(rawTableProfile.columns);
    if (!arraysEqual(physicalUfColumns, profiledColumns)) {
      throw new Error(`CRM UF profile column coverage mismatch: ${sourceTable}`);
    }
    for (const column of physicalUfColumns) {
      const counts = rawTableProfile.columns[column];
      if (
        counts.non_null_count > expectedRows ||
        counts.non_empty_count > counts.non_null_count
      ) {
        throw new Error(`Invalid CRM UF profile counts: ${sourceTable}.${column}`);
      }
      const sourceFieldBinding = sourceFieldBindings.get(`${sourceTable}.${column}`);
      if (selected.has(column)) {
        if (!sourceFieldBinding) {
          throw new Error(`Selected physical CRM UF lacks source-field binding: ${sourceTable}.${column}`);
        }
        crmUfValueProfiles.push({
          source_table: sourceTable,
          column,
          total_rows: expectedRows,
          non_null_count: counts.non_null_count,
          non_empty_count: counts.non_empty_count,
          semantic_disposition: "mapped",
          target_ids: [
            ...new Set([
              sourceFieldBinding.canonical_target_id,
              "migration.provenance",
            ]),
          ].sort(),
          source_field_binding: sourceFieldBinding.binding,
        });
      } else if (coveredMirrors.has(column)) {
        const mirrorBinding = physicalMirrorBindings.get(`${sourceTable}.${column}`);
        if (!mirrorBinding || counts.non_empty_count <= 0) {
          throw new Error(`Invalid covered CRM UF mirror: ${sourceTable}.${column}`);
        }
        crmUfValueProfiles.push({
          source_table: sourceTable,
          column,
          total_rows: expectedRows,
          non_null_count: counts.non_null_count,
          non_empty_count: counts.non_empty_count,
          semantic_disposition: "excluded",
          reason_code: "serialized_multi_value_mirror_excluded_canonical_source_b_utm",
          approved_basis: "source-field-map.json#/common_rules",
          decision_owner: "migration_data_owner",
          decision_status: "approved_canonical_b_utm_source",
          cutover_blocking: false,
          target_ids: [
            mirrorBinding.canonical_target_id,
            "migration.provenance",
          ].sort(),
          canonical_source_binding: mirrorBinding.canonical_source_binding,
        });
      } else if (quarantined.has(column)) {
        const fieldMetadata = fieldMetadataByPhysicalColumn.get(
          `${sourceTable}.${column}`,
        );
        if (!fieldMetadata || counts.non_empty_count <= 0) {
          throw new Error(`Invalid populated CRM UF quarantine: ${sourceTable}.${column}`);
        }
        crmUfValueProfiles.push({
          source_table: sourceTable,
          column,
          total_rows: expectedRows,
          non_null_count: counts.non_null_count,
          non_empty_count: counts.non_empty_count,
          semantic_disposition: "quarantined",
          reason_code:
            `populated_unmapped_crm_uf_field_${fieldMetadata.definition_id}_pending_owner_decision`,
          reason_detail:
            `${sourceTable}.${column} is populated and has source field ` +
            `${fieldMetadata.definition_id} (${fieldMetadata.user_type_id}, multiple=${fieldMetadata.multiple}, mandatory=${fieldMetadata.mandatory}) ` +
            "but no approved canonical mapping; preserve only in restricted field quarantine pending migration_data_owner decision",
          source_field_metadata: fieldMetadata,
          target_ids: ["migration.unmapped_custom_field_quarantine"],
          decision_owner: "migration_data_owner",
          decision_status: "pending",
          cutover_blocking: true,
        });
      } else {
        if (sourceFieldBinding) {
          throw new Error(
            `Mapped physical CRM UF is not selected in manifest: ${sourceTable}.${column}`,
          );
        }
        crmUfValueProfiles.push({
          source_table: sourceTable,
          column,
          total_rows: expectedRows,
          non_null_count: counts.non_null_count,
          non_empty_count: counts.non_empty_count,
          semantic_disposition: "excluded",
          reason_code: counts.non_empty_count === 0
            ? "empty_physical_uf_not_selected_by_versioned_mapping"
            : "populated_physical_uf_missing_disposition",
        });
        if (counts.non_empty_count > 0) {
          throw new Error(
            `Populated CRM UF lacks mapped/mirror/quarantine disposition: ${sourceTable}.${column}`,
          );
        }
      }
    }
  }

  return {
    registry_version: "1.0.0",
    snapshot_sha256: SNAPSHOT_SHA256,
    ledger_table_count: tables.length,
    included_table_count: EXPECTED_INCLUDED_TABLES,
    quarantine_table_count: EXPECTED_QUARANTINE_TABLES,
    coverage_denominator: EXPECTED_ROW_OUTCOMES,
    disposition_cardinality: "exactly_one_disposition_per_source_column",
    crm_uf_profile_contract: {
      scope:
        "every physical UF_* schema column in b_uts_crm_contact, b_uts_crm_deal and b_crm_dynamic_items_1042",
      value_logging: false,
      non_null_definition: "SQL value is not NULL",
      non_empty_definition: "SQL value is not NULL and is not the empty string",
      table_totals: CRM_UF_PROFILE_TABLE_TOTALS,
      expected_disposition_totals: {
        mapped: 36,
        approved_serialized_mirror_excluded: 7,
        populated_unmapped_quarantined: 63,
        empty_excluded: 9,
        total: 115,
      },
      quarantine_values_in_generated_artifact: false,
    },
    crm_uf_value_profiles: crmUfValueProfiles,
    tables,
  };
}

function buildSourceTableDispositionCsv(manifest, schemaInventory) {
  const manifestByTable = new Map(manifest.entities.map((entity) => [entity.source_table, entity]));
  const nonManifestDispositionOverrides = {
    b_disk_external_link: {
      disposition: "quarantine_only",
      reason_code: "legacy_external_link_secret_revoke_or_reissue_decision_required",
      domain_owner: "security_and_migration_data_owner",
      decision_status: "pending_signed_decision_blocks_full",
    },
  };
  const header = [
    "source_table",
    "rows",
    "disposition",
    "reason_code",
    "domain_owner",
    "decision_status",
    "migration_query_id",
    "transform_version",
    "expected_row_outcomes",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const table of Object.keys(schemaInventory.tables).sort()) {
    const definition = schemaInventory.tables[table];
    const entity = manifestByTable.get(table);
    const override = nonManifestDispositionOverrides[table];
    const values = entity
      ? entity.source_disposition === "quarantine_only"
        ? [
            table,
            definition.data.rows,
            "quarantine_only",
            "source_semantics_unverified_preserve_in_restricted_quarantine",
            "migration_data_owner",
            "pending_signed_semantics_decision_before_gate_d",
            entity.migration_query_id,
            entity.transform_version,
            entity.expected_row_outcomes,
          ]
        : [
            table,
            definition.data.rows,
            "include_row_ledger",
            "contract_scope_manifest_v2",
            "migration_data_owner",
            "baseline_approved_for_domain_migration",
            entity.migration_query_id,
            entity.transform_version,
            entity.expected_row_outcomes,
          ]
      : override
        ? [
            table,
            definition.data.rows,
            override.disposition,
            override.reason_code,
            override.domain_owner,
            override.decision_status,
            "N/A",
            "N/A",
            0,
          ]
        : [
            table,
            definition.data.rows,
            "exclude_with_reason",
            "outside_contract_scope_v1",
            "legacy_system_owner",
            "requires_owner_confirmation_before_gate_d",
            "N/A",
            "N/A",
            0,
          ];
    lines.push(values.map(csvEscape).join(","));
  }
  if (lines.length - 1 !== EXPECTED_SOURCE_TABLES) {
    throw new Error(`Expected ${EXPECTED_SOURCE_TABLES} table dispositions, found ${lines.length - 1}`);
  }
  return `${lines.join("\n")}\n`;
}

const PERIOD_RELATION_REQUIRED_FIELDS = [
  "subject_id",
  "actor_id",
  "actor_kind",
  "role",
  "valid_from",
  "valid_to",
  "source_table",
  "source_key",
  "provenance",
];

const periodedRelationDefinitions = {
  "identity.organization_unit_head": {
    relation_type: "perioded_membership",
    endpoints: ["identity.organization_unit", "identity.employee_profile"],
    endpoint_roles: {
      subject_target_ids: ["identity.organization_unit"],
      actor_target_ids: ["identity.employee_profile"],
    },
    allowed_roles: ["head"],
    historical_actor_roles: [],
    operational_owner_roles: ["head"],
    source_bindings: [
      {
        source_table: "b_uts_iblock_3_section",
        subject_column: "VALUE_ID",
        actor_column: "UF_HEAD",
        fixed_role: "head",
      },
    ],
  },
  "identity.employee_unit_membership": {
    relation_type: "perioded_membership",
    endpoints: ["identity.employee_profile", "identity.organization_unit"],
    endpoint_roles: {
      actor_target_ids: ["identity.employee_profile"],
      subject_target_ids: ["identity.organization_unit"],
    },
    allowed_roles: ["member"],
    historical_actor_roles: [],
    operational_owner_roles: ["member"],
    source_bindings: [
      {
        source_table: "b_utm_user",
        actor_column: "VALUE_ID",
        subject_column: "VALUE_INT",
        predicate: "FIELD_ID=40",
      },
    ],
  },
  "crm.crm_profile_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: ["crm.crm_profile", "identity.employee_profile", "identity.legacy_actor"],
    endpoint_roles: {
      subject_target_ids: ["crm.crm_profile"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: ["owner", "creator", "modifier", "observer"],
    historical_actor_roles: ["creator", "modifier"],
    operational_owner_roles: ["owner"],
    membership_roles: ["observer"],
    source_bindings: [
      {
        source_table: "b_crm_contact",
        role_columns: {
          owner: "ASSIGNED_BY_ID",
          creator: "CREATED_BY_ID",
          modifier: "MODIFY_BY_ID",
        },
      },
      {
        source_table: "b_crm_observer",
        predicate: "ENTITY_TYPE_ID = 3",
        subject_column: "ENTITY_ID",
        actor_column: "USER_ID",
        fixed_role: "observer",
        valid_from_column: "CREATED_TIME",
        source_updated_at_column: "LAST_UPDATED_TIME",
      },
    ],
  },
  "crm.case_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: ["crm.crm_case", "identity.employee_profile", "identity.legacy_actor"],
    endpoint_roles: {
      subject_target_ids: ["crm.crm_case"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: ["owner", "creator", "modifier", "observer"],
    historical_actor_roles: ["creator", "modifier"],
    operational_owner_roles: ["owner"],
    membership_roles: ["observer"],
    source_bindings: [
      {
        source_table: "b_crm_deal",
        role_columns: {
          owner: "ASSIGNED_BY_ID",
          creator: "CREATED_BY_ID",
          modifier: "MODIFY_BY_ID",
        },
      },
      {
        source_table: "b_crm_observer",
        predicate: "ENTITY_TYPE_ID = 2",
        subject_column: "ENTITY_ID",
        actor_column: "USER_ID",
        fixed_role: "observer",
        valid_from_column: "CREATED_TIME",
        source_updated_at_column: "LAST_UPDATED_TIME",
      },
    ],
  },
  "crm.employer_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: ["crm.employer", "identity.employee_profile", "identity.legacy_actor"],
    endpoint_roles: {
      subject_target_ids: ["crm.employer"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: ["owner", "creator", "modifier"],
    historical_actor_roles: ["creator", "modifier"],
    operational_owner_roles: ["owner"],
    source_bindings: [
      {
        source_table: "b_crm_company",
        role_columns: {
          owner: "ASSIGNED_BY_ID",
          creator: "CREATED_BY_ID",
          modifier: "MODIFY_BY_ID",
        },
      },
    ],
  },
  "crm.employer_referral_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: [
      "crm.employer_referral",
      "identity.employee_profile",
      "identity.legacy_actor",
    ],
    endpoint_roles: {
      subject_target_ids: ["crm.employer_referral"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: ["owner", "creator", "modifier"],
    historical_actor_roles: ["creator", "modifier"],
    operational_owner_roles: ["owner"],
    source_bindings: [
      {
        source_table: "b_crm_dynamic_items_1042",
        role_columns: {
          owner: "ASSIGNED_BY_ID",
          creator: "CREATED_BY",
          modifier: "UPDATED_BY",
        },
      },
    ],
  },
  "crm.task_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: ["crm.crm_task", "identity.employee_profile", "identity.legacy_actor"],
    endpoint_roles: {
      subject_target_ids: ["crm.crm_task"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: [
      "owner",
      "responsible",
      "co_executor",
      "originator",
      "creator",
      "modifier",
    ],
    historical_actor_roles: ["originator", "creator", "modifier"],
    operational_owner_roles: ["owner", "responsible", "co_executor"],
    source_bindings: [
      {
        source_table: "b_tasks",
        role_columns: {
          responsible: "RESPONSIBLE_ID",
          creator: "CREATED_BY",
          modifier: "CHANGED_BY",
        },
      },
      {
        source_table: "b_tasks_member",
        actor_column: "USER_ID",
        role_discriminator_column: "TYPE",
        role_map_ref: "migration-scope-manifest.json#/legacy_relation_type_maps/b_tasks_member.TYPE",
      },
    ],
  },
  "project.task_assignment": {
    relation_type: "perioded_actor_assignment",
    endpoints: ["project.project_task", "identity.employee_profile", "identity.legacy_actor"],
    endpoint_roles: {
      subject_target_ids: ["project.project_task"],
      actor_target_ids: ["identity.employee_profile", "identity.legacy_actor"],
    },
    allowed_roles: [
      "owner",
      "responsible",
      "co_executor",
      "originator",
      "creator",
      "modifier",
    ],
    historical_actor_roles: ["originator", "creator", "modifier"],
    operational_owner_roles: ["owner", "responsible", "co_executor"],
    source_bindings: [
      {
        source_table: "b_tasks",
        role_columns: {
          responsible: "RESPONSIBLE_ID",
          creator: "CREATED_BY",
          modifier: "CHANGED_BY",
        },
      },
      {
        source_table: "b_tasks_member",
        actor_column: "USER_ID",
        role_discriminator_column: "TYPE",
        role_map_ref: "migration-scope-manifest.json#/legacy_relation_type_maps/b_tasks_member.TYPE",
      },
    ],
  },
};

const relationEndpoints = {
  "crm.activity_binding": [
    "crm.crm_activity",
    "crm.crm_profile",
    "crm.crm_case",
    "crm.employer",
    "crm.employer_referral",
  ],
  "crm.case_person": ["crm.crm_case", "identity.person"],
  "crm.task_dependency": ["crm.crm_task"],
  "crm.case_relation": [
    "crm.crm_case",
    "identity.person",
    "crm.employer",
    "crm.employer_referral",
  ],
  "crm.profile_relation": ["crm.crm_profile", "identity.person", "crm.employer"],
  "crm.recommender_link": ["identity.person"],
  "project.task_dependency": ["project.project_task"],
  "crm.timeline_binding": [
    "crm.timeline_event",
    "crm.crm_profile",
    "crm.crm_case",
    "crm.employer",
    "crm.employer_referral",
  ],
  "platform.activity_attachment_binding": ["crm.crm_activity", "platform.attachment"],
  "platform.entity_attachment_binding": [
    "platform.attachment",
    "crm.crm_profile",
    "crm.crm_case",
    "crm.employer",
    "crm.employer_referral",
    "crm.crm_task",
    "project.project_task",
  ],
  "platform.timeline_attachment_binding": ["crm.timeline_event", "platform.attachment"],
};

const structuredTargetDefinitions = {
  "crm.case_stage_history": {
    required_fields: [
      "case_id",
      "from_stage_id",
      "to_stage_id",
      "category_id",
      "stage_semantic_id",
      "actor_id",
      "actor_kind",
      "effective_from",
      "effective_to",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "versioned stage mapping exists",
      "effective_from <= effective_to when both are present",
      "unmapped category/stage is conflict_recorded",
    ],
  },
  "crm.employer_referral_stage_history": {
    required_fields: [
      "employer_referral_id",
      "from_stage_id",
      "to_stage_id",
      "stage_semantic_id",
      "actor_id",
      "actor_kind",
      "effective_from",
      "effective_to",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "OWNER_TYPE_ID = 1042",
      "CATEGORY_ID = 8",
      "versioned stage mapping exists",
    ],
  },
  "crm.task_history": {
    required_fields: [
      "task_id",
      "changed_field",
      "before_value_protected",
      "after_value_protected",
      "actor_id",
      "actor_kind",
      "occurred_at",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: ["task_domain = crm", "history value logging is forbidden"],
  },
  "project.task_history": {
    required_fields: [
      "task_id",
      "changed_field",
      "before_value_protected",
      "after_value_protected",
      "actor_id",
      "actor_kind",
      "occurred_at",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: ["task_domain = project", "history value logging is forbidden"],
  },
  "crm.task_dependency": {
    required_fields: [
      "task_id",
      "predecessor_task_id",
      "dependency_kind",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "both endpoints have task_domain = crm",
      "task_id != predecessor_task_id",
      "accepted edge does not create a cycle",
      "DIRECT = 1",
    ],
  },
  "project.task_dependency": {
    required_fields: [
      "task_id",
      "predecessor_task_id",
      "dependency_kind",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "both endpoints have task_domain = project",
      "task_id != predecessor_task_id",
      "accepted edge does not create a cycle",
      "DIRECT = 1",
    ],
  },
  "migration.source_task_stage_definition": {
    required_fields: [
      "source_stage_id",
      "title_protected",
      "entity_type",
      "system_type",
      "sort",
      "color",
      "referenced",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "technical serialized payload is not directly mapped",
      "canonical workflow write requires signed stage map",
    ],
  },
  "migration.source_task_stage_membership": {
    required_fields: [
      "source_task_id",
      "source_stage_id",
      "task_reference_status",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "no valid_from timestamp is fabricated",
      "no canonical workflow state is inferred",
    ],
  },
  "crm.task_stage_definition": {
    required_fields: [
      "code",
      "label",
      "sort",
      "color",
      "active",
      "mapping_version",
      "provenance",
    ],
    migration_status: "blocked_pending_signed_stage_map",
    invariants: ["legacy entity type alone must not infer CRM workflow semantics"],
  },
  "project.task_stage_definition": {
    required_fields: [
      "code",
      "label",
      "sort",
      "color",
      "active",
      "mapping_version",
      "provenance",
    ],
    migration_status: "blocked_pending_signed_stage_map",
    invariants: ["legacy entity type alone must not infer project workflow semantics"],
  },
  "crm.task_result": {
    required_fields: [
      "task_id",
      "comment_id",
      "text_protected",
      "status",
      "created_by_actor_id",
      "created_at",
      "updated_at",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: ["task_domain = crm", "result text is protected and never logged"],
  },
  "platform.attachment_acl": {
    required_fields: [
      "attachment_id",
      "principal_id",
      "principal_kind",
      "permission",
      "effect",
      "inherited_from_storage_id",
      "valid_from",
      "valid_to",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "default deny",
      "unknown principal blocks FULL",
      "undecoded b_disk_right.TASK_ID blocks FULL",
    ],
  },
  "platform.attachment_storage": {
    required_fields: [
      "storage_id",
      "owner_principal_id",
      "owner_principal_kind",
      "root_attachment_id",
      "uses_internal_rights",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: ["orphan root or unknown owner blocks FULL"],
  },
  "crm.consent_snapshot": {
    required_fields: [
      "subject_id",
      "consent_kind",
      "legacy_boolean_value",
      "legacy_source_field",
      "policy_version",
      "captured_at",
      "source_table",
      "source_key",
      "provenance",
    ],
    invariants: [
      "policy_version is null or unknown",
      "captured_at is null unless source proves timestamp",
      "legacy snapshot is not current legal authorization",
    ],
  },
  "migration.unmapped_custom_field_quarantine": {
    required_fields: [
      "source_table",
      "source_key",
      "source_column",
      "encrypted_value",
      "source_field_definition_id",
      "reason_code",
      "decision_status",
      "provenance",
    ],
    invariants: [
      "raw value is restricted encrypted quarantine only",
      "raw value never appears in generated artifacts, stdout or logs",
      "pending owner decision blocks cutover",
    ],
  },
  "migration.crm_stage_history_quarantine": {
    required_fields: [
      "source_table",
      "source_key",
      "owner_type_id",
      "is_supposed",
      "encrypted_payload",
      "decision_status",
      "provenance",
    ],
    invariants: [
      "canonical history write is forbidden before signed semantics decision",
      "payload is never logged",
    ],
  },
  "migration.legacy_reference": {
    required_fields: [
      "source_system",
      "source_entity",
      "source_id",
      "target_entity",
      "target_id",
      "provenance",
    ],
    invariants: ["unique(source_system, source_entity, source_id)"],
  },
};

const relationTargets = new Set([
  ...Object.keys(periodedRelationDefinitions),
  ...Object.keys(relationEndpoints),
]);

function targetKind(target) {
  if (target === "crm.employer_referral.case_id") return "foreign_key";
  if (relationTargets.has(target)) return "relation";
  if (target.startsWith("migration.")) return "migration_evidence";
  return "entity";
}

function buildTargetModelRegistry(manifest) {
  const targetSources = new Map();
  for (const entity of manifest.entities) {
    for (const target of entity.target ?? []) {
      if (!targetSources.has(target)) targetSources.set(target, new Set());
      targetSources.get(target).add(entity.source_table);
    }
  }
  const supplementalTargetSources = {
    "identity.employee_profile": ["b_user", "b_utm_user"],
    "identity.user_account": ["b_user"],
    "crm.consent_snapshot": ["b_uts_crm_contact"],
    "crm.task_stage_definition": ["b_tasks_stages"],
    "project.task_stage_definition": ["b_tasks_stages"],
    "migration.legacy_reference": manifest.entities.map((entity) => entity.source_table),
    "migration.unmapped_custom_field_quarantine": [
      "b_uts_crm_contact",
      "b_uts_crm_deal",
    ],
  };
  for (const [target, sourceTables] of Object.entries(supplementalTargetSources)) {
    if (!targetSources.has(target)) targetSources.set(target, new Set());
    for (const sourceTable of sourceTables) targetSources.get(target).add(sourceTable);
  }

  const targets = [...targetSources.entries()]
    .map(([id, sourceTables]) => {
      const periodedRelation = periodedRelationDefinitions[id];
      return {
        id,
        kind: targetKind(id),
        source_tables: [...sourceTables].sort(),
        ...(relationEndpoints[id] ? { endpoints: relationEndpoints[id] } : {}),
        ...(periodedRelation
          ? {
              ...periodedRelation,
              required_fields: PERIOD_RELATION_REQUIRED_FIELDS,
              actor_contract_ref:
                "migration-scope-manifest.json#/actor_assignment_contract",
              valid_from_policy:
                "source timestamp when available, otherwise migration effective_at with inferred provenance",
              valid_to_policy:
                "null for current relation; closed explicitly when operational assignment changes",
            }
          : {}),
        ...(structuredTargetDefinitions[id] ?? {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    registry_version: "1.0.0",
    snapshot_sha256: SNAPSHOT_SHA256,
    canonical_id_format: "namespace.object_or_relation",
    assignment_semantics: manifest.actor_assignment_contract,
    semantic_fingerprint_contract: manifest.semantic_fingerprint_contract,
    consent_snapshot_contract: manifest.consent_snapshot_contract,
    file_acl_contract: manifest.file_acl_contract,
    targets,
    source_field_target_aliases: Object.entries(SOURCE_FIELD_TARGET_ALIASES).map(
      ([alias, canonicalId]) => ({ alias, canonical_id: canonicalId }),
    ),
  };
}

async function main() {
  const schemaInventory = readJson(files.schemaInventory);
  if (schemaInventory.source.sha256 !== SNAPSHOT_SHA256) {
    throw new Error("Schema inventory snapshot SHA256 mismatch");
  }
  if (Object.keys(schemaInventory.tables).length !== EXPECTED_SOURCE_TABLES) {
    throw new Error(
      `Expected ${EXPECTED_SOURCE_TABLES} source tables, found ${Object.keys(schemaInventory.tables).length}`,
    );
  }

  const metadataExtraction = await extractMetadataRows(schemaInventory);
  validateTaskMemberTypes(metadataExtraction.rows.b_tasks_member);
  const requirementRows = parseCsv(fs.readFileSync(files.requirements, "utf8"));
  const manifest = normalizeManifest(
    readJson(files.manifest),
    schemaInventory,
    metadataExtraction.crmUfProfiles,
    metadataExtraction.rows,
  );
  const sourceFieldMap = normalizeSourceFieldMap(
    readJson(files.sourceFieldMap),
    metadataExtraction.rows,
  );
  addSourceFieldTargetsToManifest(manifest, sourceFieldMap);
  const queryRegistry = buildMigrationQueryRegistry(manifest, requirementRows);
  const columnManifest = buildColumnDispositionManifest(
    manifest,
    schemaInventory,
    metadataExtraction.crmUfProfiles,
    sourceFieldMap,
    metadataExtraction.rows,
  );
  const tableDispositions = buildSourceTableDispositionCsv(manifest, schemaInventory);
  const targetModel = buildTargetModelRegistry(manifest);

  writeJson(files.manifest, manifest);
  writeJson(files.sourceFieldMap, sourceFieldMap);
  writeJson(files.migrationQueries, queryRegistry);
  writeJson(files.columnDispositions, columnManifest);
  fs.writeFileSync(files.tableDispositions, tableDispositions, "utf8");
  writeJson(files.targetModel, targetModel);

  console.log(`generated manifest tables: ${manifest.entities.length}`);
  console.log(`generated row outcomes: ${EXPECTED_ROW_OUTCOMES}`);
  console.log(`generated source table dispositions: ${EXPECTED_SOURCE_TABLES}`);
  console.log(
    `generated migration queries: ${queryRegistry.source_extract_query_count} source + ${queryRegistry.requirement_evidence_query_count} requirement`,
  );
  console.log(`generated target registry entries: ${targetModel.targets.length}`);
}

await main();
