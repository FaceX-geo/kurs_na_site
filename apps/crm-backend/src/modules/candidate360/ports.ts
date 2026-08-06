import type { CursorValue, Page } from "../../common/pagination.js";
import type { CrmAccessScope, CrmActorContext } from "../crm/ports.js";
import type {
  Candidate360Provenance,
  CandidateDocument,
  CandidateDocumentContentState,
  CandidateDocumentListQuery,
  CandidateDocumentReviewDecision,
  CandidateDocumentReviewResult,
  CandidateRecommender,
  CandidateRecommenderListQuery,
  CandidateRecommenderState,
  DuplicateCandidate,
  DuplicateCandidateListQuery,
  DuplicateCandidateState,
  LinkRecommenderBody,
  MergeCandidateBody,
  MergeCandidateResult,
  RecommenderLink,
  RecommenderRelationshipType,
  ReviewDocumentBody,
} from "./contracts.js";
import type { Candidate360OperationDefinition } from "./registry.js";

export interface Candidate360ResourceReference {
  readonly type: Candidate360OperationDefinition["resourceType"];
  readonly id: string;
}

export interface Candidate360AuthorizationRequest {
  readonly actor: CrmActorContext;
  readonly operation: Candidate360OperationDefinition;
  readonly resource?: Candidate360ResourceReference;
}

export interface Candidate360AuthorizationPort {
  authorize(request: Candidate360AuthorizationRequest): Promise<CrmAccessScope>;
}

export interface Candidate360RepositoryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: CursorValue | null;
  readonly hasMore: boolean;
}

export interface DuplicateCandidateRepositoryQuery {
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
  readonly state: DuplicateCandidateState;
  readonly personId?: string;
  readonly minimumConfidence?: number;
}

export interface CandidateDocumentRepositoryQuery {
  readonly personId: string;
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
  readonly documentKind?: string;
  readonly reviewState?: CandidateDocument["reviewState"];
}

export interface CandidateRecommenderRepositoryQuery {
  readonly candidatePersonId: string;
  readonly cursor: CursorValue | undefined;
  readonly limit: number;
  readonly state: CandidateRecommenderState;
}

export type CandidateDocumentContentAccess =
  | {
      readonly kind: "ready";
      readonly documentId: string;
      readonly storageKey: string;
      readonly originalName: string;
      readonly mediaType: string;
      readonly byteSize: number;
      readonly sha256: string;
    }
  | { readonly kind: "blocked"; readonly state: CandidateDocumentContentState }
  | { readonly kind: "not_found" };

export interface CandidateDocumentContent {
  readonly documentId: string;
  readonly originalName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface CandidateDocumentContentStorePort {
  /** Must reject an object larger than maxBytes and must not include its storage key in errors. */
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

export interface MergeCandidateCommand {
  readonly duplicateCandidateId: string;
  readonly survivorPersonId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly provenance: Candidate360Provenance;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export interface LinkRecommenderCommand {
  readonly candidatePersonId: string;
  readonly recommenderPersonId: string;
  readonly relationshipType: RecommenderRelationshipType;
  readonly expectedCandidateVersion: number;
  readonly reason: string;
  readonly provenance: Candidate360Provenance;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export interface ReviewDocumentCommand {
  readonly documentId: string;
  readonly decision: CandidateDocumentReviewDecision;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly provenance: Candidate360Provenance;
  readonly actor: CrmActorContext;
  readonly access: CrmAccessScope;
}

export type Candidate360MutationResult<T> =
  | { readonly kind: "succeeded"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_conflict"; readonly currentVersion: number }
  | { readonly kind: "state_conflict"; readonly currentState: string; readonly currentVersion: number }
  | { readonly kind: "scan_not_clean"; readonly scanState: string; readonly currentVersion: number }
  | { readonly kind: "employee_identity_conflict"; readonly personIds: readonly string[] }
  | { readonly kind: "invalid_survivor" }
  | { readonly kind: "already_linked"; readonly linkId: string; readonly currentVersion: number };

export interface Candidate360RepositoryPort {
  /** Applies both candidates' access scope in SQL before returning a duplicate row. */
  listDuplicateCandidates(
    access: CrmAccessScope,
    query: DuplicateCandidateRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<DuplicateCandidate>>;
  /** Applies the candidate's case scope in SQL before returning document metadata. */
  listCandidateDocuments(
    access: CrmAccessScope,
    query: CandidateDocumentRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<CandidateDocument>>;
  getCandidateDocument(access: CrmAccessScope, documentId: string): Promise<CandidateDocument | null>;
  /** Applies SQL scope to both the candidate and the related recommender. */
  listCandidateRecommenders(
    access: CrmAccessScope,
    query: CandidateRecommenderRepositoryQuery,
  ): Promise<Candidate360RepositoryPage<CandidateRecommender>>;
  /** Returns an internal key only after SQL scope and the clean-scan gate have both passed. */
  getCandidateDocumentContentAccess(
    access: CrmAccessScope,
    documentId: string,
  ): Promise<CandidateDocumentContentAccess>;
  /** Re-checks scope and scan state, then writes a metadata-only audit event. */
  recordCandidateDocumentContentAccess(
    actor: CrmActorContext,
    access: CrmAccessScope,
    documentId: string,
  ): Promise<boolean>;
  /**
   * Atomically locks the duplicate, rejects employee identities, writes the logical merge ledger/history,
   * increments the duplicate version, and appends audit/outbox records. Identity rows are never modified.
   */
  mergeCandidate(command: MergeCandidateCommand): Promise<Candidate360MutationResult<MergeCandidateResult>>;
  /** Atomically writes the relation/history/audit/outbox and increments the candidate profile version. */
  linkRecommender(command: LinkRecommenderCommand): Promise<Candidate360MutationResult<RecommenderLink>>;
  /** Atomically updates document state and writes immutable review history/audit/outbox. */
  reviewDocument(
    command: ReviewDocumentCommand,
  ): Promise<Candidate360MutationResult<CandidateDocumentReviewResult>>;
}

export interface Candidate360ServicePort {
  listDuplicateCandidates(
    actor: CrmActorContext,
    query: DuplicateCandidateListQuery,
  ): Promise<Page<DuplicateCandidate>>;
  listCandidateDocuments(
    actor: CrmActorContext,
    personId: string,
    query: CandidateDocumentListQuery,
  ): Promise<Page<CandidateDocument>>;
  getCandidateDocument(actor: CrmActorContext, documentId: string): Promise<CandidateDocument>;
  getCandidateDocumentContent(actor: CrmActorContext, documentId: string): Promise<CandidateDocumentContent>;
  listCandidateRecommenders(
    actor: CrmActorContext,
    candidatePersonId: string,
    query: CandidateRecommenderListQuery,
  ): Promise<Page<CandidateRecommender>>;
  mergeCandidate(
    actor: CrmActorContext,
    duplicateCandidateId: string,
    expectedVersion: number,
    body: MergeCandidateBody,
  ): Promise<MergeCandidateResult>;
  linkRecommender(
    actor: CrmActorContext,
    candidatePersonId: string,
    expectedCandidateVersion: number,
    body: LinkRecommenderBody,
  ): Promise<RecommenderLink>;
  reviewDocument(
    actor: CrmActorContext,
    documentId: string,
    expectedVersion: number,
    body: ReviewDocumentBody,
  ): Promise<CandidateDocumentReviewResult>;
}
