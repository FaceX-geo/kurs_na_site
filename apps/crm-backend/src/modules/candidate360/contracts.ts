import { type Static, Type } from "@sinclair/typebox";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../../common/upload-policy.js";

const UuidSchema = Type.String({ format: "uuid" });
const IsoTimestampSchema = Type.String({ format: "date-time" });
const VersionSchema = Type.Integer({ minimum: 1 });
const CodeSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
});
const ReasonSchema = Type.String({ minLength: 8, maxLength: 2_000 });

export const Candidate360ProvenanceSchema = Type.Object(
  {
    origin: Type.Union([
      Type.Literal("manual"),
      Type.Literal("integration"),
      Type.Literal("migration"),
      Type.Literal("dedup_engine"),
    ]),
    sourceSystem: Type.Optional(CodeSchema),
    sourceReference: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    evidenceReferences: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
        maxItems: 50,
        uniqueItems: true,
      }),
    ),
  },
  { additionalProperties: false },
);

export const Candidate360VersionHeadersSchema = Type.Object(
  {
    "if-match": Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const Candidate360PageMetadataSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 200 }),
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DuplicateCandidateStateSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("confirmed_duplicate"),
  Type.Literal("kept_separate"),
  Type.Literal("superseded"),
]);

export const DuplicateCandidatePersonSchema = Type.Object(
  {
    personId: UuidSchema,
    displayName: Type.String({ minLength: 1, maxLength: 500 }),
    profileState: Type.String({ minLength: 1, maxLength: 96 }),
    hasEmployeeIdentity: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DuplicateCandidateSchema = Type.Object(
  {
    id: UuidSchema,
    left: DuplicateCandidatePersonSchema,
    right: DuplicateCandidatePersonSchema,
    matchReasons: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 100 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    state: DuplicateCandidateStateSchema,
    activeMergeId: Type.Union([UuidSchema, Type.Null()]),
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const DuplicateCandidatePageSchema = Type.Object(
  {
    items: Type.Array(DuplicateCandidateSchema),
    page: Candidate360PageMetadataSchema,
  },
  { additionalProperties: false },
);

export const DuplicateCandidateListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    state: Type.Optional(DuplicateCandidateStateSchema),
    personId: Type.Optional(UuidSchema),
    minimumConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

export const DuplicateCandidateParamsSchema = Type.Object(
  { duplicateId: UuidSchema },
  { additionalProperties: false },
);

export const MergeCandidateBodySchema = Type.Object(
  {
    survivorPersonId: UuidSchema,
    reason: ReasonSchema,
    provenance: Type.Optional(Candidate360ProvenanceSchema),
  },
  { additionalProperties: false },
);

export const MergeCandidateResultSchema = Type.Object(
  {
    mergeId: UuidSchema,
    duplicateCandidateId: UuidSchema,
    survivorPersonId: UuidSchema,
    mergedPersonId: UuidSchema,
    state: Type.Literal("active"),
    reversible: Type.Literal(true),
    mergeVersion: VersionSchema,
    duplicateVersion: VersionSchema,
    reviewedByUserAccountId: UuidSchema,
    reason: ReasonSchema,
    provenance: Candidate360ProvenanceSchema,
    mergedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CandidatePersonParamsSchema = Type.Object(
  { personId: UuidSchema },
  { additionalProperties: false },
);

export const RecommenderRelationshipTypeSchema = Type.Union([
  Type.Literal("referrer"),
  Type.Literal("mentor"),
  Type.Literal("community_contact"),
]);

export const LinkRecommenderBodySchema = Type.Object(
  {
    recommenderPersonId: UuidSchema,
    relationshipType: RecommenderRelationshipTypeSchema,
    reason: ReasonSchema,
    provenance: Type.Optional(Candidate360ProvenanceSchema),
  },
  { additionalProperties: false },
);

export const RecommenderLinkSchema = Type.Object(
  {
    id: UuidSchema,
    candidatePersonId: UuidSchema,
    recommenderPersonId: UuidSchema,
    relationshipType: RecommenderRelationshipTypeSchema,
    state: Type.Literal("active"),
    version: VersionSchema,
    candidateVersion: VersionSchema,
    linkedByUserAccountId: UuidSchema,
    reason: ReasonSchema,
    provenance: Candidate360ProvenanceSchema,
    linkedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CandidateDocumentParamsSchema = Type.Object(
  { documentId: UuidSchema },
  { additionalProperties: false },
);

export const CandidateDocumentReviewStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("needs_revision"),
]);

export const CandidateDocumentContentStateSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("scan_pending"),
  Type.Literal("rejected"),
  Type.Literal("scan_failed"),
  Type.Literal("external_unavailable"),
]);

export const CandidateDocumentSchema = Type.Object(
  {
    id: UuidSchema,
    personId: UuidSchema,
    caseId: Type.Union([UuidSchema, Type.Null()]),
    documentKind: CodeSchema,
    originalName: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
    mediaType: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    byteSize: Type.Union([Type.Integer({ minimum: 1, maximum: UPLOAD_STORAGE_CEILING_BYTES }), Type.Null()]),
    sha256: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
    contentState: CandidateDocumentContentStateSchema,
    reviewState: CandidateDocumentReviewStateSchema,
    lastReviewedByUserAccountId: Type.Union([UuidSchema, Type.Null()]),
    lastReviewedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
    provenance: Candidate360ProvenanceSchema,
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CandidateDocumentPageSchema = Type.Object(
  {
    items: Type.Array(CandidateDocumentSchema),
    page: Candidate360PageMetadataSchema,
  },
  { additionalProperties: false },
);

export const CandidateDocumentListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    documentKind: Type.Optional(CodeSchema),
    reviewState: Type.Optional(CandidateDocumentReviewStateSchema),
  },
  { additionalProperties: false },
);

export const CandidateDocumentContentSchema = Type.String({ format: "binary" });

export const CandidateRecommenderStateSchema = Type.Union([Type.Literal("active"), Type.Literal("revoked")]);

export const CandidateRecommenderSchema = Type.Object(
  {
    id: UuidSchema,
    candidatePersonId: UuidSchema,
    recommenderPersonId: UuidSchema,
    recommenderDisplayName: Type.String({ minLength: 1, maxLength: 500 }),
    relationshipType: RecommenderRelationshipTypeSchema,
    state: CandidateRecommenderStateSchema,
    version: VersionSchema,
    linkedByUserAccountId: UuidSchema,
    reason: ReasonSchema,
    provenance: Candidate360ProvenanceSchema,
    linkedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CandidateRecommenderPageSchema = Type.Object(
  {
    items: Type.Array(CandidateRecommenderSchema),
    page: Candidate360PageMetadataSchema,
  },
  { additionalProperties: false },
);

export const CandidateRecommenderListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    state: Type.Optional(CandidateRecommenderStateSchema),
  },
  { additionalProperties: false },
);

export const CandidateDocumentReviewDecisionSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("needs_revision"),
]);

export const ReviewDocumentBodySchema = Type.Object(
  {
    decision: CandidateDocumentReviewDecisionSchema,
    reason: ReasonSchema,
    provenance: Type.Optional(Candidate360ProvenanceSchema),
  },
  { additionalProperties: false },
);

export const CandidateDocumentReviewResultSchema = Type.Object(
  {
    documentId: UuidSchema,
    personId: UuidSchema,
    documentKind: CodeSchema,
    previousState: Type.Union([
      Type.Literal("pending"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("needs_revision"),
    ]),
    reviewState: CandidateDocumentReviewDecisionSchema,
    version: VersionSchema,
    reviewerUserAccountId: UuidSchema,
    reason: ReasonSchema,
    provenance: Candidate360ProvenanceSchema,
    reviewedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export type Candidate360Provenance = Static<typeof Candidate360ProvenanceSchema>;
export type DuplicateCandidateState = Static<typeof DuplicateCandidateStateSchema>;
export type DuplicateCandidate = Static<typeof DuplicateCandidateSchema>;
export type DuplicateCandidateListQuery = Static<typeof DuplicateCandidateListQuerySchema>;
export type MergeCandidateBody = Static<typeof MergeCandidateBodySchema>;
export type MergeCandidateResult = Static<typeof MergeCandidateResultSchema>;
export type RecommenderRelationshipType = Static<typeof RecommenderRelationshipTypeSchema>;
export type LinkRecommenderBody = Static<typeof LinkRecommenderBodySchema>;
export type RecommenderLink = Static<typeof RecommenderLinkSchema>;
export type CandidateRecommenderState = Static<typeof CandidateRecommenderStateSchema>;
export type CandidateRecommender = Static<typeof CandidateRecommenderSchema>;
export type CandidateRecommenderListQuery = Static<typeof CandidateRecommenderListQuerySchema>;
export type CandidateDocumentReviewState = Static<typeof CandidateDocumentReviewStateSchema>;
export type CandidateDocumentContentState = Static<typeof CandidateDocumentContentStateSchema>;
export type CandidateDocument = Static<typeof CandidateDocumentSchema>;
export type CandidateDocumentListQuery = Static<typeof CandidateDocumentListQuerySchema>;
export type CandidateDocumentReviewDecision = Static<typeof CandidateDocumentReviewDecisionSchema>;
export type ReviewDocumentBody = Static<typeof ReviewDocumentBodySchema>;
export type CandidateDocumentReviewResult = Static<typeof CandidateDocumentReviewResultSchema>;
