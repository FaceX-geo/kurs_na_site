import type { CursorValue, Page } from "../../common/pagination.js";
import type { ResolvedCrmTransition } from "../../registry/crm-state-registry.js";
import type { CrmOperationDefinition } from "../../registry/operation-registry.js";
import type {
  CrmActivity,
  CrmActivityListQuery,
  CrmCandidateSummary,
  CrmCaseDetail,
  CrmCaseListQuery,
  CrmCaseSummary,
  CrmCaseTransitionBody,
  CrmCaseTransitionResult,
  CrmDictionaryList,
  CrmEmployerDetail,
  CrmEmployerListQuery,
  CrmEmployerSummary,
  CrmFunnel,
  CrmPersonListQuery,
  CrmPersonSummary,
  CrmReferralDetail,
  CrmReferralListQuery,
  CrmReferralSummary,
  CrmTaskDetail,
  CrmTaskListQuery,
  CrmTaskSummary,
  CrmTaskTransitionBody,
  CrmTimelineQuery,
} from "./contracts.js";

export interface CrmActorContext {
  readonly userAccountId: string;
  readonly employeeProfileId: string | null;
  readonly requestId: string;
}

export interface CrmResourceReference {
  readonly type: CrmOperationDefinition["resourceType"];
  readonly id: string;
}

export interface CrmAccessScope {
  readonly visibility: "assigned" | "team" | "department" | "all";
  readonly actorUserAccountId: string;
  readonly actorEmployeeProfileId: string | null;
  /** Explicit employee profiles visible through assigned/team scope expansion. */
  readonly employeeProfileIds: readonly string[];
  readonly teamIds: readonly string[];
  readonly organizationUnitIds: readonly string[];
  readonly fieldMask: readonly string[];
}

export interface CrmAuthorizationRequest {
  readonly actor: CrmActorContext;
  readonly operation: CrmOperationDefinition;
  readonly permissionCode: string;
  readonly resource?: CrmResourceReference;
}

export interface CrmAuthorizationPort {
  authorize(request: CrmAuthorizationRequest): Promise<CrmAccessScope>;
}

export interface CrmRepositoryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: CursorValue | null;
  readonly hasMore: boolean;
}

export interface CrmRepositoryPageRequest {
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
}

export type CrmCaseRepositoryQuery = Omit<CrmCaseListQuery, "cursor" | "limit"> & CrmRepositoryPageRequest;
export type CrmPersonRepositoryQuery = Omit<CrmPersonListQuery, "cursor" | "limit"> &
  CrmRepositoryPageRequest;
export type CrmEmployerRepositoryQuery = Omit<CrmEmployerListQuery, "cursor" | "limit"> &
  CrmRepositoryPageRequest;
export type CrmReferralRepositoryQuery = Omit<CrmReferralListQuery, "cursor" | "limit"> &
  CrmRepositoryPageRequest;
export type CrmTaskRepositoryQuery = Omit<CrmTaskListQuery, "cursor" | "limit"> & CrmRepositoryPageRequest;
export type CrmActivityRepositoryQuery = Omit<CrmActivityListQuery, "cursor" | "limit"> &
  CrmRepositoryPageRequest;
export type CrmTimelineRepositoryQuery = Omit<CrmTimelineQuery, "cursor" | "limit"> &
  CrmRepositoryPageRequest;

export interface CrmTransitionExecution {
  readonly aggregateId: string;
  readonly expectedVersion: number;
  readonly fromState: string;
  readonly toState: string;
  readonly machineCode: string;
  readonly machineVersion: number;
  readonly transition: ResolvedCrmTransition["transition"];
  readonly targetAggregateStatus: string | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export interface CrmIdempotencyContext {
  readonly key: string;
  readonly scope: string;
  readonly requestHash: string;
}

export interface CrmIdempotentResult<T> {
  readonly value: T;
  readonly replayed: boolean;
}

export interface CrmCaseTransitionExecution extends CrmTransitionExecution {
  readonly idempotency: CrmIdempotencyContext;
}

export interface CrmCaseTransitionReplayQuery {
  readonly aggregateId: string;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
  readonly idempotency: CrmIdempotencyContext;
}

export type CrmMutationResult<T> =
  | { readonly kind: "updated"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_conflict"; readonly currentVersion: number }
  | { readonly kind: "state_conflict"; readonly currentState: string; readonly currentVersion: number }
  | {
      readonly kind: "guard_failed";
      readonly errors: readonly { readonly field: string; readonly code: string; readonly message: string }[];
    };

export interface CrmRepositoryPort {
  /**
   * List queries must apply the supplied access scope in SQL and use the stable
   * `(created_at, id)` cursor order. Filtering only after loading rows is forbidden.
   */
  listCases(
    access: CrmAccessScope,
    query: CrmCaseRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmCaseSummary>>;
  getCase(access: CrmAccessScope, caseId: string): Promise<CrmCaseDetail | null>;
  /**
   * Returns the authoritative response stored for an exact completed request.
   * Implementations must fail closed for changed payloads, incomplete claims,
   * malformed receipts and resources outside the supplied SQL scope.
   */
  findCaseTransitionReplay(query: CrmCaseTransitionReplayQuery): Promise<CrmCaseTransitionResult | null>;
  /**
   * A transition implementation must atomically write the aggregate version,
   * state history, mandatory audit event and outbox event. No partial success is valid.
   */
  transitionCase(
    command: CrmCaseTransitionExecution,
  ): Promise<CrmMutationResult<CrmIdempotentResult<CrmCaseTransitionResult>>>;

  listPeople(
    access: CrmAccessScope,
    query: CrmPersonRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmPersonSummary>>;
  getCandidateSummary(access: CrmAccessScope, personId: string): Promise<CrmCandidateSummary | null>;

  listEmployers(
    access: CrmAccessScope,
    query: CrmEmployerRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmEmployerSummary>>;
  getEmployer(access: CrmAccessScope, employerId: string): Promise<CrmEmployerDetail | null>;

  listReferrals(
    access: CrmAccessScope,
    query: CrmReferralRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmReferralSummary>>;
  getReferral(access: CrmAccessScope, referralId: string): Promise<CrmReferralDetail | null>;

  listTasks(
    access: CrmAccessScope,
    query: CrmTaskRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmTaskSummary>>;
  getTask(access: CrmAccessScope, taskId: string): Promise<CrmTaskDetail | null>;
  /** Same transaction and optimistic-lock invariants as transitionCase. */
  transitionTask(command: CrmTransitionExecution): Promise<CrmMutationResult<CrmTaskDetail>>;

  listActivities(
    access: CrmAccessScope,
    query: CrmActivityRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmActivity>>;
  listCaseTimeline(
    access: CrmAccessScope,
    caseId: string,
    query: CrmTimelineRepositoryQuery,
  ): Promise<CrmRepositoryPage<CrmActivity> | null>;
}

export interface CrmServicePort {
  listCases(actor: CrmActorContext, query: CrmCaseListQuery): Promise<Page<CrmCaseSummary>>;
  getCase(actor: CrmActorContext, caseId: string): Promise<CrmCaseDetail>;
  transitionCase(
    actor: CrmActorContext,
    caseId: string,
    expectedVersion: number,
    idempotencyKey: string,
    body: CrmCaseTransitionBody,
  ): Promise<CrmIdempotentResult<CrmCaseTransitionResult>>;

  listPeople(actor: CrmActorContext, query: CrmPersonListQuery): Promise<Page<CrmPersonSummary>>;
  getCandidateSummary(actor: CrmActorContext, personId: string): Promise<CrmCandidateSummary>;

  listEmployers(actor: CrmActorContext, query: CrmEmployerListQuery): Promise<Page<CrmEmployerSummary>>;
  getEmployer(actor: CrmActorContext, employerId: string): Promise<CrmEmployerDetail>;

  listReferrals(actor: CrmActorContext, query: CrmReferralListQuery): Promise<Page<CrmReferralSummary>>;
  getReferral(actor: CrmActorContext, referralId: string): Promise<CrmReferralDetail>;

  listTasks(actor: CrmActorContext, query: CrmTaskListQuery): Promise<Page<CrmTaskSummary>>;
  getTask(actor: CrmActorContext, taskId: string): Promise<CrmTaskDetail>;
  transitionTask(
    actor: CrmActorContext,
    taskId: string,
    expectedVersion: number,
    body: CrmTaskTransitionBody,
  ): Promise<CrmTaskDetail>;

  listActivities(actor: CrmActorContext, query: CrmActivityListQuery): Promise<Page<CrmActivity>>;
  listCaseTimeline(
    actor: CrmActorContext,
    caseId: string,
    query: CrmTimelineQuery,
  ): Promise<Page<CrmActivity>>;

  listDictionaries(actor: CrmActorContext): Promise<CrmDictionaryList>;
  listFunnels(actor: CrmActorContext): Promise<readonly CrmFunnel[]>;
  getFunnel(actor: CrmActorContext, funnelCode: string, version?: number): Promise<CrmFunnel>;
}
