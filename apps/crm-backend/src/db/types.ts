import type { ColumnType, Generated } from "kysely";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type CreatedTimestamp = ColumnType<Date, Date | string | undefined, never>;
export type JsonDocument = ColumnType<unknown, unknown, unknown>;
export type NullableJsonDocument = ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
export type DefaultJsonDocument = ColumnType<unknown, unknown | undefined, unknown>;
export type OptionalInsert<T> = ColumnType<T, T | undefined, T>;

interface VersionedRow {
  id: string;
  version: Generated<number>;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

export interface SchemaMigrationTable {
  version: string;
  checksum: string;
  applied_at: CreatedTimestamp;
}

export interface PublicContentTable {
  id: string;
  public_id: string;
  document: JsonDocument;
  publication_state: string;
  version: OptionalInsert<number>;
  published_at: Timestamp | null;
  created_by: string;
  updated_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

export interface PublicContentRevisionTable {
  id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  document: JsonDocument;
  publication_state: string;
  actor_user_account_id: string;
  reason: string;
  created_at: Timestamp;
}

export interface PersonTable extends VersionedRow {
  surname: string;
  given_name: string;
  middle_name: string | null;
  birth_date: ColumnType<Date | null, string | null | undefined, string | null>;
  normalized_email: string | null;
  normalized_phone: string | null;
}

export interface EmployeeProfileTable extends VersionedRow {
  person_id: string;
  employee_number: string | null;
  organization_unit_id: string | null;
  employment_state: string;
}

export interface UserAccountTable extends VersionedRow {
  person_id: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  account_state: string;
  credential_state: string;
  risk_state: string;
  mfa_state: string;
  failed_login_count: Generated<number>;
  locked_until: Timestamp | null;
}

export interface SessionTable {
  id: string;
  user_account_id: string;
  token_hash: string;
  csrf_token_hash: string;
  authentication_level: string;
  user_agent_hash: string | null;
  ip_prefix: string | null;
  created_at: CreatedTimestamp;
  last_seen_at: Timestamp;
  idle_expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: string | null;
}

export interface MfaFactorTable extends VersionedRow {
  user_account_id: string;
  provider_code: string;
  state: string;
  secret_ciphertext: Buffer | null;
  provider_subject_ref: string | null;
  enrolled_at: Timestamp | null;
  last_used_at: Timestamp | null;
}

export interface AuthChallengeTable {
  id: string;
  public_id: string;
  user_account_id: string;
  challenge_type: string;
  provider_code: string;
  token_hash: string;
  state: string;
  attempt_count: Generated<number>;
  expires_at: Timestamp;
  verified_at: Timestamp | null;
  created_at: CreatedTimestamp;
}

export interface PasswordTokenTable {
  id: string;
  user_account_id: string;
  purpose: string;
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_by: string | null;
  reason: string | null;
  created_at: CreatedTimestamp;
}

export interface CredentialDeliveryTable {
  outbox_event_id: string;
  state: string;
  attempt_count: number;
  next_attempt_at: Timestamp | null;
  last_error_code: string | null;
  provider_reference: string | null;
  delivered_at: Timestamp | null;
  dead_lettered_at: Timestamp | null;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

export interface RecoveryCodeTable {
  user_account_id: string;
  code_hash: string;
  used_at: Timestamp | null;
  created_at: CreatedTimestamp;
}

export interface ApprovalRequestTable extends VersionedRow {
  public_id: string;
  proposer_id: string;
  approver_id: string | null;
  subject_id: string | null;
  operation_code: string;
  permission_code: string;
  scope: JsonDocument;
  payload_hash: string;
  reason: string;
  state: string;
  expires_at: Timestamp;
  decided_at: Timestamp | null;
  executed_at: Timestamp | null;
}

export interface BootstrapCeremonyTable {
  singleton: Generated<boolean>;
  mode: string;
  state: string;
  first_person_id: string;
  second_person_id: string | null;
  manifest_sha256: string;
  owner_approval_ref: string;
  ceremony_operator_ref: string;
  started_at: Timestamp;
  completed_at: Timestamp | null;
  closed_at: Timestamp | null;
}

export interface RoleTable {
  code: string;
  domain: string;
  title: string;
  description: string;
  is_privileged: boolean;
}

export interface PermissionTable {
  code: string;
  domain: string;
  description: string;
}

export interface RolePermissionTable {
  role_code: string;
  permission_code: string;
}

export interface UserRoleAssignmentTable extends VersionedRow {
  user_account_id: string;
  role_code: string;
  scope_type: string;
  scope_id: string | null;
  valid_from: Timestamp;
  valid_to: Timestamp | null;
  assigned_by: string;
  reason: string;
}

export interface CrmProfileTable extends VersionedRow {
  person_id: string;
  profile_state: string;
  data_quality_state: string;
}

export interface ProgramParticipationTable extends VersionedRow {
  crm_profile_id: string;
  program_type: string;
  status: string;
  started_at: Timestamp;
  ended_at: Timestamp | null;
}

export interface CandidateSourceTable extends VersionedRow {
  crm_profile_id: string;
  submission_id: string | null;
  source_code: string;
  entry_point_code: string | null;
  vacancy_id: string | null;
  first_touch: JsonDocument;
  last_touch: JsonDocument;
  consent_policy_version: string | null;
  consent_accepted_at: Timestamp | null;
  consent_evidence: JsonDocument;
}

export interface CrmCaseTable extends VersionedRow {
  public_id: string;
  participation_id: string | null;
  funnel_code: string;
  funnel_version: number;
  stage_code: string;
  title: string;
  status: string;
  next_step: string | null;
  attributes: DefaultJsonDocument;
  source_created_at: Timestamp | null;
}

export interface CasePersonTable {
  case_id: string;
  person_id: string;
  relationship_type: string;
  is_primary: boolean;
  created_at: CreatedTimestamp;
}

export interface CaseAssignmentTable extends VersionedRow {
  case_id: string;
  employee_profile_id: string | null;
  legacy_actor_id: string | null;
  role: string;
  valid_from: Timestamp;
  valid_to: Timestamp | null;
  provenance: JsonDocument;
}

export interface CaseStageHistoryTable {
  id: string;
  case_id: string;
  from_stage_code: string | null;
  to_stage_code: string;
  reason_code: string | null;
  reason_text: string | null;
  actor_user_account_id: string | null;
  source_stage: string | null;
  aggregate_version: number;
  occurred_at: Timestamp;
  created_at: CreatedTimestamp;
}

export interface EmployerTable extends VersionedRow {
  public_id: string;
  name: string;
  legal_name: string | null;
  normalized_tax_id: string | null;
  status: string;
  provenance: JsonDocument;
  organization_type: OptionalInsert<string>;
  manual_review_reason: OptionalInsert<string | null>;
}

export interface EmployerContactTable extends VersionedRow {
  employer_id: string;
  person_id: string | null;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

export interface EmployerAssignmentTable extends VersionedRow {
  employer_id: string;
  employee_profile_id: string;
  role: string;
  valid_from: Timestamp;
  valid_to: Timestamp | null;
  provenance: DefaultJsonDocument;
}

export interface EmployerReferralTable extends VersionedRow {
  public_id: string;
  case_id: string | null;
  person_id: string | null;
  employer_id: string | null;
  owner_employee_profile_id: string | null;
  stage_code: string;
  channel_code: string | null;
  vacancy_title: string | null;
  sent_at: Timestamp | null;
  result_at: Timestamp | null;
  comment: OptionalInsert<string | null>;
  provenance: JsonDocument;
}

export interface RelocationProfileTable extends VersionedRow {
  case_id: string;
  employer_id: string | null;
  position: string | null;
  municipality: string | null;
  locality: string | null;
  planned_date: ColumnType<Date | null, string | null | undefined, string | null>;
  actual_date: ColumnType<Date | null, string | null | undefined, string | null>;
  offer_status: OptionalInsert<string | null>;
  employment_status: OptionalInsert<string | null>;
  support_measures: DefaultJsonDocument;
  result_code: OptionalInsert<string | null>;
  result_reason: OptionalInsert<string | null>;
  household: JsonDocument;
  tickets: JsonDocument;
}

export interface CrmTaskTable extends VersionedRow {
  public_id: string;
  case_id: string | null;
  employer_referral_id: string | null;
  title: string;
  description: string | null;
  state: string;
  responsible_employee_profile_id: string | null;
  due_at: Timestamp | null;
  completed_at: Timestamp | null;
  priority: OptionalInsert<string>;
  timezone: OptionalInsert<string>;
  creator_user_account_id: OptionalInsert<string | null>;
  provenance: JsonDocument;
}

export interface EmployerReferralStageHistoryTable {
  id: string;
  employer_referral_id: string;
  from_stage_code: string | null;
  to_stage_code: string;
  reason_code: string | null;
  reason_text: string | null;
  actor_user_account_id: string;
  aggregate_version: number;
  occurred_at: Timestamp;
  created_at: CreatedTimestamp;
}

export interface CrmTaskParticipantTable {
  id: string;
  task_id: string;
  employee_profile_id: string;
  role: string;
  valid_from: Timestamp;
  valid_to: Timestamp | null;
  created_at: CreatedTimestamp;
}

export interface CrmTaskChecklistItemTable extends VersionedRow {
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
}

export interface CrmTaskCommentTable extends VersionedRow {
  public_id: string;
  task_id: string;
  body: string;
  author_user_account_id: string;
}

export interface CrmTaskHistoryTable {
  id: string;
  task_id: string;
  change_type: string;
  before_state: NullableJsonDocument;
  after_state: NullableJsonDocument;
  actor_user_account_id: string;
  aggregate_version: number;
  occurred_at: Timestamp;
  created_at: CreatedTimestamp;
}

export interface CrmCommunicationDraftTable extends VersionedRow {
  public_id: string;
  channel: string;
  subject: string | null;
  body: string;
  selection: JsonDocument;
  selection_fingerprint: string;
  state: string;
  created_by_user_account_id: string;
  confirmed_by_user_account_id: string | null;
  confirmed_at: Timestamp | null;
  queued_at: Timestamp | null;
}

export interface CrmCommunicationRecipientTable {
  id: string;
  draft_id: string;
  person_id: string;
  state: string;
  attempt_count: Generated<number>;
  last_error_code: string | null;
  queued_event_id: string | null;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

export interface CrmNotificationTable {
  id: string;
  public_id: string;
  recipient_user_account_id: string;
  type_code: string;
  title: string;
  payload: JsonDocument;
  read_at: Timestamp | null;
  occurred_at: Timestamp;
  created_at: CreatedTimestamp;
}

export interface CrmReportRunTable {
  id: string;
  public_id: string;
  report_code: string;
  formula_version: string;
  timezone: string;
  filters: JsonDocument;
  scope_snapshot: JsonDocument;
  state: string;
  result: JsonDocument;
  excluded_records: number;
  data_fresh_at: Timestamp;
  created_by_user_account_id: string;
  created_at: CreatedTimestamp;
}

export interface CrmSettingVersionTable {
  id: string;
  setting_code: string;
  version: number;
  config: JsonDocument;
  state: string;
  reason: string;
  created_by_user_account_id: string;
  activated_at: Timestamp | null;
  created_at: CreatedTimestamp;
}

export interface CrmActivityTable {
  id: string;
  public_id: string;
  case_id: string | null;
  person_id: string | null;
  employer_id: string | null;
  employer_referral_id: string | null;
  activity_type: string;
  direction: string | null;
  subject: string | null;
  body_copy: string | null;
  delivery_state: string | null;
  occurred_at: Timestamp;
  actor_employee_profile_id: string | null;
  legacy_actor_id: string | null;
  provenance: JsonDocument;
  created_at: CreatedTimestamp;
}

export interface DuplicateCandidateTable extends VersionedRow {
  left_person_id: string;
  right_person_id: string;
  match_reasons: JsonDocument;
  confidence: number;
  state: string;
  resolution: JsonDocument | null;
  reviewed_by: string | null;
  reviewed_at: Timestamp | null;
}

export interface IntakeUploadTable {
  id: string;
  public_id: string;
  storage_key: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  scan_state: string;
  linked_submission_id: string | null;
  binding_token_hash: string | null;
  binding_key_version: number | null;
  binding_consumed_at: Timestamp | null;
  expires_at: Timestamp;
  created_at: CreatedTimestamp;
}

export interface IntakeUploadReservationTable {
  id: string;
  public_id: string;
  idempotency_key: string;
  request_hash: string;
  storage_key: string;
  original_name: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  binding_token_hash: string;
  binding_key_version: number;
  state: string;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
  committed_at: Timestamp | null;
}

export interface IntakeSubmissionTable {
  id: string;
  public_id: string;
  schema_version: string;
  applicant_type: string;
  payload: JsonDocument;
  normalized_email_hash: string;
  normalized_phone_hash: string;
  consent_policy_version: string | null;
  consent_accepted_at: Timestamp | null;
  source_code: string;
  entry_point_code: string | null;
  vacancy_id: string | null;
  status: string;
  routed_case_id: string | null;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

export interface AuditEventTable {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  subject_type: string;
  subject_id: string | null;
  request_id: string | null;
  reason: string | null;
  before_state: NullableJsonDocument;
  after_state: NullableJsonDocument;
  metadata: JsonDocument;
  policy_version: string | null;
  scope_snapshot: NullableJsonDocument;
  occurred_at: CreatedTimestamp;
  previous_hash: string | null;
  event_hash: string;
}

export interface OutboxEventTable {
  id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: JsonDocument;
  idempotency_key: string;
  occurred_at: CreatedTimestamp;
  available_at: Timestamp;
  attempt_count: Generated<number>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  delivered_at: Timestamp | null;
  last_error_code: string | null;
}

export interface InboxEventTable {
  consumer: string;
  event_id: string;
  result: JsonDocument;
  processed_at: CreatedTimestamp;
}

export interface IdempotencyRecordTable {
  scope: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number | null;
  response_body: NullableJsonDocument;
  resource_id: string | null;
  state: string;
  locked_until: Timestamp | null;
  expires_at: Timestamp;
  created_at: CreatedTimestamp;
  updated_at: Timestamp;
}

export interface LegacyReferenceTable {
  source_system: string;
  source_entity: string;
  source_id: string;
  target_type: string;
  target_id: string;
  snapshot_sha256: string;
  created_at: CreatedTimestamp;
}

export interface LegacyActorTable {
  id: string;
  source_user_id: string;
  display_label: string;
  classification: string;
  employee_profile_id: string | null;
  provenance: JsonDocument;
  created_at: CreatedTimestamp;
}

export interface MigrationRunTable {
  id: string;
  public_id: string;
  source_system: string;
  snapshot_sha256: string;
  manifest_version: string;
  transform_version: string;
  state: string;
  started_at: CreatedTimestamp;
  finished_at: Timestamp | null;
  counts: JsonDocument;
  blockers: JsonDocument;
  mode: string | null;
  adapter_name: string | null;
  expected_rows: Generated<number>;
  processed_rows: Generated<number>;
  already_applied_rows: Generated<number>;
  outcome_counts: DefaultJsonDocument;
  failure_code: string | null;
}

export interface MigrationLedgerTable {
  run_id: string;
  snapshot_sha256: string;
  source_table: string;
  source_key: JsonDocument;
  source_key_hash: string;
  transform_version: string;
  outcome: string;
  target_type: string | null;
  target_id: string | null;
  reason_code: string | null;
  evidence: JsonDocument;
  processed_at: CreatedTimestamp;
  ledger_key: string | null;
  source_key_digest: string | null;
  attempt: Generated<number>;
  recorded_at: CreatedTimestamp;
}

export interface MigrationLedgerAttemptTable {
  id: Generated<string>;
  attempt_no: Generated<number>;
  run_id: string;
  ledger_key: string;
  snapshot_sha256: string;
  source_table: string;
  source_key_digest: string;
  transform_version: string;
  projection: string;
  outcome: string;
  reason_code: string;
  recorded_at: CreatedTimestamp;
}

export interface MigrationLedgerTargetTable {
  attempt_id: string;
  target_ordinal: number;
  target_type: string;
  target_id: string | null;
  target_action: string;
  projection: string;
  reason_code: string | null;
  target_key_digest: string;
  recorded_at: CreatedTimestamp;
}

export interface MigrationConflictTable extends VersionedRow {
  run_id: string;
  conflict_type: string;
  source_table: string;
  source_key: JsonDocument;
  severity: string;
  state: string;
  reason_code: string;
  evidence: JsonDocument;
  assigned_to: string | null;
  resolution: NullableJsonDocument;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
}

export interface Database {
  "platform.schema_migration": SchemaMigrationTable;
  "content.vacancy": PublicContentTable;
  "content.story": PublicContentTable;
  "content.revision": PublicContentRevisionTable;
  "identity.person": PersonTable;
  "identity.employee_profile": EmployeeProfileTable;
  "identity.user_account": UserAccountTable;
  "identity.session": SessionTable;
  "identity.mfa_factor": MfaFactorTable;
  "identity.auth_challenge": AuthChallengeTable;
  "identity.password_token": PasswordTokenTable;
  "identity.credential_delivery": CredentialDeliveryTable;
  "identity.recovery_code": RecoveryCodeTable;
  "identity.approval_request": ApprovalRequestTable;
  "identity.bootstrap_ceremony": BootstrapCeremonyTable;
  "identity.role": RoleTable;
  "identity.permission": PermissionTable;
  "identity.role_permission": RolePermissionTable;
  "identity.user_role_assignment": UserRoleAssignmentTable;
  "crm.profile": CrmProfileTable;
  "crm.program_participation": ProgramParticipationTable;
  "crm.candidate_source": CandidateSourceTable;
  "crm.case": CrmCaseTable;
  "crm.case_person": CasePersonTable;
  "crm.case_assignment": CaseAssignmentTable;
  "crm.case_stage_history": CaseStageHistoryTable;
  "crm.employer": EmployerTable;
  "crm.employer_contact": EmployerContactTable;
  "crm.employer_assignment": EmployerAssignmentTable;
  "crm.employer_referral": EmployerReferralTable;
  "crm.employer_referral_stage_history": EmployerReferralStageHistoryTable;
  "crm.relocation_profile": RelocationProfileTable;
  "crm.task": CrmTaskTable;
  "crm.task_participant": CrmTaskParticipantTable;
  "crm.task_checklist_item": CrmTaskChecklistItemTable;
  "crm.task_comment": CrmTaskCommentTable;
  "crm.task_history": CrmTaskHistoryTable;
  "crm.activity": CrmActivityTable;
  "crm.duplicate_candidate": DuplicateCandidateTable;
  "crm.communication_draft": CrmCommunicationDraftTable;
  "crm.communication_recipient": CrmCommunicationRecipientTable;
  "crm.notification": CrmNotificationTable;
  "crm.report_run": CrmReportRunTable;
  "crm.setting_version": CrmSettingVersionTable;
  "intake.upload": IntakeUploadTable;
  "intake.upload_reservation": IntakeUploadReservationTable;
  "intake.submission": IntakeSubmissionTable;
  "platform.audit_event": AuditEventTable;
  "platform.outbox_event": OutboxEventTable;
  "platform.inbox_event": InboxEventTable;
  "platform.idempotency_record": IdempotencyRecordTable;
  "platform.legacy_reference": LegacyReferenceTable;
  "migration.legacy_actor": LegacyActorTable;
  "migration.run": MigrationRunTable;
  "migration.ledger": MigrationLedgerTable;
  "migration.ledger_attempt": MigrationLedgerAttemptTable;
  "migration.ledger_target": MigrationLedgerTargetTable;
  "migration.conflict": MigrationConflictTable;
}
