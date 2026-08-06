import { type Static, Type } from "@sinclair/typebox";

const IdentifierSchema = Type.String({ minLength: 1, maxLength: 160 });
const CodeSchema = Type.String({ minLength: 1, maxLength: 96, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" });
const IsoTimestampSchema = Type.String({ minLength: 20, maxLength: 40, format: "date-time" });
const NullableIdentifierSchema = Type.Union([IdentifierSchema, Type.Null()]);
const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const NullableTimestampSchema = Type.Union([IsoTimestampSchema, Type.Null()]);
const VersionSchema = Type.Integer({ minimum: 1 });

export const CrmPageQueryProperties = {
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
};

export const CrmPageMetadataSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 200 }),
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CrmCaseSummarySchema = Type.Object(
  {
    id: IdentifierSchema,
    publicId: IdentifierSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    funnelCode: CodeSchema,
    funnelVersion: VersionSchema,
    stageCode: CodeSchema,
    status: CodeSchema,
    nextStep: NullableStringSchema,
    primaryPersonId: NullableIdentifierSchema,
    ownerEmployeeProfileId: NullableIdentifierSchema,
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmCasePersonLinkSchema = Type.Object(
  {
    personId: IdentifierSchema,
    relationshipType: CodeSchema,
    isPrimary: Type.Boolean(),
    displayName: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

export const CrmCaseAssignmentSchema = Type.Object(
  {
    employeeProfileId: NullableIdentifierSchema,
    legacyActorId: NullableIdentifierSchema,
    role: CodeSchema,
    validFrom: IsoTimestampSchema,
    validTo: NullableTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmRelocationProfileSchema = Type.Object(
  {
    employerId: NullableIdentifierSchema,
    position: NullableStringSchema,
    municipality: NullableStringSchema,
    locality: NullableStringSchema,
    plannedDate: Type.Union([Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }), Type.Null()]),
    actualDate: Type.Union([Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }), Type.Null()]),
    offerStatus: NullableStringSchema,
    employmentStatus: NullableStringSchema,
    household: Type.Record(Type.String(), Type.Unknown()),
    supportMeasures: Type.Array(Type.String()),
    resultCode: NullableStringSchema,
    resultReason: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const CrmCaseDetailSchema = Type.Intersect(
  [
    CrmCaseSummarySchema,
    Type.Object(
      {
        people: Type.Array(CrmCasePersonLinkSchema),
        assignments: Type.Array(CrmCaseAssignmentSchema),
        relocation: Type.Union([CrmRelocationProfileSchema, Type.Null()]),
        attributes: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
);

export const CrmCasePageSchema = Type.Object(
  { items: Type.Array(CrmCaseSummarySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmCaseListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    funnelCode: Type.Optional(CodeSchema),
    funnelVersion: Type.Optional(VersionSchema),
    stageCode: Type.Optional(CodeSchema),
    status: Type.Optional(CodeSchema),
    personId: Type.Optional(IdentifierSchema),
    ownerEmployeeProfileId: Type.Optional(IdentifierSchema),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const CrmCaseParamsSchema = Type.Object({ caseId: IdentifierSchema }, { additionalProperties: false });

export const CrmVersionHeadersSchema = Type.Object(
  {
    "if-match": Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CrmCaseTransitionHeadersSchema = Type.Object(
  {
    "if-match": Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    "idempotency-key": Type.String({
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
    }),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CrmCaseTransitionBodySchema = Type.Object(
  {
    toStageCode: CodeSchema,
    reasonCode: Type.Optional(CodeSchema),
    reasonText: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    evidence: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const CrmCaseTransitionReceiptSchema = Type.Object(
  {
    id: IdentifierSchema,
    auditEventId: IdentifierSchema,
    operationId: Type.Literal("TransitionCase"),
    requestId: Type.String({ minLength: 1, maxLength: 256 }),
    caseId: IdentifierSchema,
    version: VersionSchema,
    occurredAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmCaseTransitionResultSchema = Type.Object(
  {
    case: CrmCaseDetailSchema,
    receipt: CrmCaseTransitionReceiptSchema,
  },
  { additionalProperties: false },
);

export const CrmPersonContactMaskSchema = Type.Object(
  {
    email: NullableStringSchema,
    phone: NullableStringSchema,
  },
  { additionalProperties: false },
);

export const CrmPersonSummarySchema = Type.Object(
  {
    id: IdentifierSchema,
    displayName: Type.String({ minLength: 1, maxLength: 500 }),
    contactMask: CrmPersonContactMaskSchema,
    profileState: CodeSchema,
    dataQualityState: CodeSchema,
    activeCaseCount: Type.Integer({ minimum: 0 }),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmPersonPageSchema = Type.Object(
  { items: Type.Array(CrmPersonSummarySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmPersonListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    profileState: Type.Optional(CodeSchema),
    dataQualityState: Type.Optional(CodeSchema),
    programType: Type.Optional(CodeSchema),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const CrmPersonParamsSchema = Type.Object(
  { personId: IdentifierSchema },
  { additionalProperties: false },
);

export const CrmProgramParticipationSchema = Type.Object(
  {
    id: IdentifierSchema,
    programType: CodeSchema,
    status: CodeSchema,
    startedAt: IsoTimestampSchema,
    endedAt: NullableTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmCandidateSummarySchema = Type.Object(
  {
    person: CrmPersonSummarySchema,
    participations: Type.Array(CrmProgramParticipationSchema),
    cases: Type.Array(CrmCaseSummarySchema),
    referralCount: Type.Integer({ minimum: 0 }),
    pendingTaskCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const CrmEmployerSummarySchema = Type.Object(
  {
    id: IdentifierSchema,
    publicId: IdentifierSchema,
    name: Type.String({ minLength: 1, maxLength: 500 }),
    legalName: NullableStringSchema,
    taxIdMask: NullableStringSchema,
    status: CodeSchema,
    organizationType: CodeSchema,
    contactCount: Type.Integer({ minimum: 0 }),
    openReferralCount: Type.Integer({ minimum: 0 }),
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmEmployerContactSchema = Type.Object(
  {
    id: IdentifierSchema,
    name: Type.String({ minLength: 1, maxLength: 500 }),
    position: NullableStringSchema,
    email: NullableStringSchema,
    phone: NullableStringSchema,
    isPrimary: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CrmEmployerDetailSchema = Type.Intersect(
  [
    CrmEmployerSummarySchema,
    Type.Object(
      {
        contacts: Type.Array(CrmEmployerContactSchema),
        manualReviewReason: NullableStringSchema,
        ownerEmployeeProfileId: NullableIdentifierSchema,
        provenance: Type.Record(Type.String(), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
);

export const CrmEmployerPageSchema = Type.Object(
  { items: Type.Array(CrmEmployerSummarySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmEmployerListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    status: Type.Optional(CodeSchema),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const CrmEmployerParamsSchema = Type.Object(
  { employerId: IdentifierSchema },
  { additionalProperties: false },
);

export const CrmReferralSummarySchema = Type.Object(
  {
    id: IdentifierSchema,
    publicId: IdentifierSchema,
    caseId: NullableIdentifierSchema,
    personId: NullableIdentifierSchema,
    employerId: NullableIdentifierSchema,
    ownerEmployeeProfileId: NullableIdentifierSchema,
    stageCode: CodeSchema,
    channelCode: Type.Union([CodeSchema, Type.Null()]),
    vacancyTitle: NullableStringSchema,
    sentAt: NullableTimestampSchema,
    resultAt: NullableTimestampSchema,
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmReferralDetailSchema = Type.Intersect(
  [
    CrmReferralSummarySchema,
    Type.Object(
      {
        comment: NullableStringSchema,
        stageHistory: Type.Array(
          Type.Object(
            {
              id: IdentifierSchema,
              fromStageCode: Type.Union([CodeSchema, Type.Null()]),
              toStageCode: CodeSchema,
              reasonCode: Type.Union([CodeSchema, Type.Null()]),
              reasonText: NullableStringSchema,
              actorUserAccountId: IdentifierSchema,
              aggregateVersion: VersionSchema,
              occurredAt: IsoTimestampSchema,
            },
            { additionalProperties: false },
          ),
        ),
        provenance: Type.Record(Type.String(), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
);

export const CrmReferralPageSchema = Type.Object(
  { items: Type.Array(CrmReferralSummarySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmReferralListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    caseId: Type.Optional(IdentifierSchema),
    personId: Type.Optional(IdentifierSchema),
    employerId: Type.Optional(IdentifierSchema),
    ownerEmployeeProfileId: Type.Optional(IdentifierSchema),
    stageCode: Type.Optional(CodeSchema),
  },
  { additionalProperties: false },
);

export const CrmReferralParamsSchema = Type.Object(
  { referralId: IdentifierSchema },
  { additionalProperties: false },
);

export const CrmTaskSummarySchema = Type.Object(
  {
    id: IdentifierSchema,
    publicId: IdentifierSchema,
    caseId: NullableIdentifierSchema,
    employerReferralId: NullableIdentifierSchema,
    title: Type.String({ minLength: 1, maxLength: 500 }),
    description: NullableStringSchema,
    state: CodeSchema,
    responsibleEmployeeProfileId: NullableIdentifierSchema,
    dueAt: NullableTimestampSchema,
    completedAt: NullableTimestampSchema,
    priority: Type.Union([
      Type.Literal("low"),
      Type.Literal("normal"),
      Type.Literal("high"),
      Type.Literal("urgent"),
    ]),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    creatorUserAccountId: NullableIdentifierSchema,
    isOverdue: Type.Boolean(),
    version: VersionSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);

export const CrmTaskDetailSchema = Type.Intersect(
  [
    CrmTaskSummarySchema,
    Type.Object(
      {
        participants: Type.Array(
          Type.Object(
            {
              employeeProfileId: IdentifierSchema,
              role: CodeSchema,
              validFrom: IsoTimestampSchema,
            },
            { additionalProperties: false },
          ),
        ),
        checklist: Type.Array(
          Type.Object(
            {
              id: IdentifierSchema,
              title: Type.String({ minLength: 1, maxLength: 500 }),
              completed: Type.Boolean(),
              position: Type.Integer({ minimum: 0 }),
              version: VersionSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 200 },
        ),
        commentCount: Type.Integer({ minimum: 0 }),
        provenance: Type.Record(Type.String(), Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
);

export const CrmTaskPageSchema = Type.Object(
  { items: Type.Array(CrmTaskSummarySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmTaskListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    caseId: Type.Optional(IdentifierSchema),
    referralId: Type.Optional(IdentifierSchema),
    state: Type.Optional(CodeSchema),
    responsibleEmployeeProfileId: Type.Optional(IdentifierSchema),
    overdue: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CrmTaskParamsSchema = Type.Object({ taskId: IdentifierSchema }, { additionalProperties: false });

export const CrmTaskTransitionBodySchema = Type.Object(
  {
    toState: CodeSchema,
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    evidence: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const CrmActivitySchema = Type.Object(
  {
    id: IdentifierSchema,
    publicId: IdentifierSchema,
    caseId: NullableIdentifierSchema,
    personId: NullableIdentifierSchema,
    employerId: NullableIdentifierSchema,
    employerReferralId: NullableIdentifierSchema,
    activityType: CodeSchema,
    direction: Type.Union([CodeSchema, Type.Null()]),
    subject: NullableStringSchema,
    bodyPreview: NullableStringSchema,
    deliveryState: Type.Union([CodeSchema, Type.Null()]),
    occurredAt: IsoTimestampSchema,
    actorEmployeeProfileId: NullableIdentifierSchema,
    legacyActorId: NullableIdentifierSchema,
    provenance: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export const CrmActivityPageSchema = Type.Object(
  { items: Type.Array(CrmActivitySchema), page: CrmPageMetadataSchema },
  { additionalProperties: false },
);

export const CrmActivityListQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    caseId: Type.Optional(IdentifierSchema),
    personId: Type.Optional(IdentifierSchema),
    employerId: Type.Optional(IdentifierSchema),
    referralId: Type.Optional(IdentifierSchema),
    activityType: Type.Optional(CodeSchema),
    direction: Type.Optional(CodeSchema),
  },
  { additionalProperties: false },
);

export const CrmTimelineQuerySchema = Type.Object(
  {
    ...CrmPageQueryProperties,
    activityType: Type.Optional(CodeSchema),
  },
  { additionalProperties: false },
);

export const CrmDictionaryValueSchema = Type.Object(
  {
    code: CodeSchema,
    title: Type.String({ minLength: 1, maxLength: 300 }),
    order: Type.Integer({ minimum: 0 }),
    active: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CrmDictionarySchema = Type.Object(
  {
    code: CodeSchema,
    version: VersionSchema,
    values: Type.Array(CrmDictionaryValueSchema),
  },
  { additionalProperties: false },
);

export const CrmDictionaryListSchema = Type.Object(
  {
    registryVersion: VersionSchema,
    items: Type.Array(CrmDictionarySchema),
  },
  { additionalProperties: false },
);

export const CrmStateSchema = Type.Object(
  {
    code: CodeSchema,
    title: Type.String({ minLength: 1, maxLength: 300 }),
    order: Type.Integer({ minimum: 0 }),
    aggregateStatus: Type.Optional(
      Type.Union([Type.Literal("open"), Type.Literal("completed"), Type.Literal("closed_unsuccessful")]),
    ),
  },
  { additionalProperties: false },
);

export const CrmTransitionSchema = Type.Object(
  {
    code: CodeSchema,
    from: Type.Array(Type.Union([CodeSchema, Type.Null()])),
    to: Type.Array(CodeSchema),
    permissionCode: CodeSchema,
    requiredFields: Type.Array(CodeSchema),
    reasonRequired: Type.Boolean(),
    targetGuard: Type.Optional(
      Type.Object(
        { type: Type.Literal("equals_history_field"), field: CodeSchema },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const CrmFunnelSchema = Type.Object(
  {
    code: CodeSchema,
    version: VersionSchema,
    title: Type.String({ minLength: 1, maxLength: 300 }),
    status: Type.Union([Type.Literal("draft"), Type.Literal("active"), Type.Literal("retired")]),
    source: Type.String({ minLength: 1, maxLength: 300 }),
    initialState: Type.Union([CodeSchema, Type.Null()]),
    states: Type.Array(CrmStateSchema),
    transitions: Type.Array(CrmTransitionSchema),
  },
  { additionalProperties: false },
);

export const CrmFunnelListSchema = Type.Object(
  { items: Type.Array(CrmFunnelSchema) },
  { additionalProperties: false },
);

export const CrmFunnelParamsSchema = Type.Object({ funnelCode: CodeSchema }, { additionalProperties: false });

export const CrmFunnelQuerySchema = Type.Object(
  { version: Type.Optional(VersionSchema) },
  { additionalProperties: false },
);

export type CrmCaseSummary = Static<typeof CrmCaseSummarySchema>;
export type CrmCaseDetail = Static<typeof CrmCaseDetailSchema>;
export type CrmCaseListQuery = Static<typeof CrmCaseListQuerySchema>;
export type CrmCaseTransitionBody = Static<typeof CrmCaseTransitionBodySchema>;
export type CrmCaseTransitionReceipt = Static<typeof CrmCaseTransitionReceiptSchema>;
export type CrmCaseTransitionResult = Static<typeof CrmCaseTransitionResultSchema>;
export type CrmPersonSummary = Static<typeof CrmPersonSummarySchema>;
export type CrmPersonListQuery = Static<typeof CrmPersonListQuerySchema>;
export type CrmCandidateSummary = Static<typeof CrmCandidateSummarySchema>;
export type CrmEmployerSummary = Static<typeof CrmEmployerSummarySchema>;
export type CrmEmployerDetail = Static<typeof CrmEmployerDetailSchema>;
export type CrmEmployerListQuery = Static<typeof CrmEmployerListQuerySchema>;
export type CrmReferralSummary = Static<typeof CrmReferralSummarySchema>;
export type CrmReferralDetail = Static<typeof CrmReferralDetailSchema>;
export type CrmReferralListQuery = Static<typeof CrmReferralListQuerySchema>;
export type CrmTaskSummary = Static<typeof CrmTaskSummarySchema>;
export type CrmTaskDetail = Static<typeof CrmTaskDetailSchema>;
export type CrmTaskListQuery = Static<typeof CrmTaskListQuerySchema>;
export type CrmTaskTransitionBody = Static<typeof CrmTaskTransitionBodySchema>;
export type CrmActivity = Static<typeof CrmActivitySchema>;
export type CrmActivityListQuery = Static<typeof CrmActivityListQuerySchema>;
export type CrmTimelineQuery = Static<typeof CrmTimelineQuerySchema>;
export type CrmDictionaryList = Static<typeof CrmDictionaryListSchema>;
export type CrmFunnel = Static<typeof CrmFunnelSchema>;
