import { type Static, Type } from "@sinclair/typebox";

const Identifier = Type.String({ minLength: 1, maxLength: 160 });
const Uuid = Type.String({ format: "uuid" });
const DateTime = Type.String({ format: "date-time" });
const NullableDateTime = Type.Union([DateTime, Type.Null()]);
const Version = Type.Integer({ minimum: 1 });
const Reason = Type.String({ minLength: 3, maxLength: 4_000 });
const Code = Type.String({ minLength: 1, maxLength: 96, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" });
const JsonObject = Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown());

export const CrmOperationsPageQueryProperties = {
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
};

export const CrmOperationsPageMetadataSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 200 }),
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CrmOperationsCreateHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
    }),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CrmOperationsVersionHeadersSchema = Type.Object(
  {
    "if-match": Type.String({ minLength: 1, maxLength: 64 }),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CrmOperationsIdempotentVersionHeadersSchema = Type.Object(
  {
    "if-match": Type.String({ minLength: 1, maxLength: 64 }),
    "idempotency-key": Type.String({
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
    }),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CommunicationDraftParamsSchema = Type.Object(
  { draftId: Identifier },
  { additionalProperties: false },
);

export const CommunicationChannelSchema = Type.Union([Type.Literal("email"), Type.Literal("max")]);
export const CommunicationRecipientSelectionSchema = Type.Array(Uuid, {
  minItems: 1,
  maxItems: 500,
  uniqueItems: true,
});

export const CreateCommunicationDraftBodySchema = Type.Object(
  {
    channel: CommunicationChannelSchema,
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    body: Type.String({ minLength: 1, maxLength: 100_000 }),
    recipientPersonIds: CommunicationRecipientSelectionSchema,
    reason: Reason,
  },
  { additionalProperties: false },
);

export const UpdateCommunicationDraftBodySchema = Type.Object(
  {
    channel: Type.Optional(CommunicationChannelSchema),
    subject: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()])),
    body: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
    recipientPersonIds: Type.Optional(CommunicationRecipientSelectionSchema),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const ConfirmCommunicationDraftBodySchema = Type.Object(
  {
    selectionFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const QueueCommunicationBodySchema = Type.Object(
  {
    selectionFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const CommunicationDraftSchema = Type.Object(
  {
    id: Identifier,
    publicId: Identifier,
    channel: CommunicationChannelSchema,
    subject: Type.Union([Type.String(), Type.Null()]),
    body: Type.String(),
    recipientPersonIds: Type.Array(Uuid),
    recipientCount: Type.Integer({ minimum: 1 }),
    selectionFingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    state: Type.Union([
      Type.Literal("draft"),
      Type.Literal("confirmed"),
      Type.Literal("queued"),
      Type.Literal("cancelled"),
    ]),
    deliveryBoundary: Type.Union([Type.Literal("approval_only"), Type.Literal("durable_outbox_only")]),
    externalDeliveryState: Type.Union([Type.Literal("not_requested"), Type.Literal("queued_internal")]),
    createdByUserAccountId: Uuid,
    confirmedByUserAccountId: Type.Union([Uuid, Type.Null()]),
    confirmedAt: NullableDateTime,
    queuedAt: NullableDateTime,
    version: Version,
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);

export const DashboardSummaryQuerySchema = Type.Object(
  { timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) },
  { additionalProperties: false },
);

export const DashboardSummarySchema = Type.Object(
  {
    openCaseCount: Type.Integer({ minimum: 0 }),
    overdueTaskCount: Type.Integer({ minimum: 0 }),
    pendingReferralCount: Type.Integer({ minimum: 0 }),
    unreadNotificationCount: Type.Integer({ minimum: 0 }),
    ownDraftCommunicationCount: Type.Integer({ minimum: 0 }),
    scopeVisibility: Type.Union([
      Type.Literal("assigned"),
      Type.Literal("team"),
      Type.Literal("department"),
      Type.Literal("all"),
    ]),
    timezone: Type.String(),
    dataFreshAt: DateTime,
  },
  { additionalProperties: false },
);

export const NotificationSchema = Type.Object(
  {
    id: Identifier,
    publicId: Identifier,
    typeCode: Code,
    title: Type.String({ minLength: 1, maxLength: 1_000 }),
    payload: JsonObject,
    readAt: NullableDateTime,
    occurredAt: DateTime,
    version: Version,
  },
  { additionalProperties: false },
);

export const NotificationListQuerySchema = Type.Object(
  {
    ...CrmOperationsPageQueryProperties,
    unreadOnly: Type.Optional(Type.Boolean()),
    typeCode: Type.Optional(Code),
  },
  { additionalProperties: false },
);
export const NotificationPageSchema = Type.Object(
  { items: Type.Array(NotificationSchema), page: CrmOperationsPageMetadataSchema },
  { additionalProperties: false },
);
export const NotificationParamsSchema = Type.Object(
  { notificationId: Identifier },
  { additionalProperties: false },
);

export const CrmReportCodeSchema = Type.Union([
  Type.Literal("pipeline.summary"),
  Type.Literal("workload.summary"),
  Type.Literal("referrals.outcomes"),
  Type.Literal("applications.sources"),
  Type.Literal("employers.activity"),
  Type.Literal("relocation.results"),
  Type.Literal("data_quality.summary"),
]);

const PipelineReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("pipeline.summary"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(
      Type.Object(
        {
          funnelCode: Type.Optional(Code),
          status: Type.Optional(Code),
        },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);
const WorkloadReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("workload.summary"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(
      Type.Object(
        {
          state: Type.Optional(Code),
          dueBefore: Type.Optional(DateTime),
        },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);
const ReferralReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("referrals.outcomes"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(Type.Object({ stageCode: Type.Optional(Code) }, { additionalProperties: false })),
    reason: Reason,
  },
  { additionalProperties: false },
);
const ApplicationSourceReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("applications.sources"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(
      Type.Object(
        { sourceCode: Type.Optional(Code), entryPointCode: Type.Optional(Code) },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);
const EmployerActivityReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("employers.activity"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(Type.Object({ status: Type.Optional(Code) }, { additionalProperties: false })),
    reason: Reason,
  },
  { additionalProperties: false },
);
const RelocationResultsReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("relocation.results"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(
      Type.Object(
        {
          resultCode: Type.Optional(Code),
          municipality: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);
const DataQualityReportInputSchema = Type.Object(
  {
    reportCode: Type.Literal("data_quality.summary"),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    filters: Type.Optional(
      Type.Object(
        { profileState: Type.Optional(Code), dataQualityState: Type.Optional(Code) },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);
export const RunReportBodySchema = Type.Union([
  PipelineReportInputSchema,
  WorkloadReportInputSchema,
  ReferralReportInputSchema,
  ApplicationSourceReportInputSchema,
  EmployerActivityReportInputSchema,
  RelocationResultsReportInputSchema,
  DataQualityReportInputSchema,
]);

export const ReportRunSchema = Type.Object(
  {
    id: Identifier,
    publicId: Identifier,
    reportCode: CrmReportCodeSchema,
    formulaVersion: Type.String({ minLength: 1, maxLength: 160 }),
    timezone: Type.String(),
    filters: JsonObject,
    scopeVisibility: Type.Union([
      Type.Literal("assigned"),
      Type.Literal("team"),
      Type.Literal("department"),
      Type.Literal("all"),
    ]),
    state: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
    result: JsonObject,
    excludedRecords: Type.Integer({ minimum: 0 }),
    dataFreshAt: DateTime,
    createdByUserAccountId: Uuid,
    createdAt: DateTime,
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export const ReportRunListQuerySchema = Type.Object(
  {
    ...CrmOperationsPageQueryProperties,
    reportCode: Type.Optional(CrmReportCodeSchema),
    state: Type.Optional(Type.Union([Type.Literal("completed"), Type.Literal("failed")])),
  },
  { additionalProperties: false },
);
export const ReportRunPageSchema = Type.Object(
  { items: Type.Array(ReportRunSchema), page: CrmOperationsPageMetadataSchema },
  { additionalProperties: false },
);
export const ReportRunParamsSchema = Type.Object(
  { reportRunId: Identifier },
  { additionalProperties: false },
);

export const ReportExportSchema = Type.Object(
  {
    reportRunId: Identifier,
    reportCode: CrmReportCodeSchema,
    formulaVersion: Type.String({ minLength: 1, maxLength: 160 }),
    format: Type.Literal("csv"),
    filename: Type.String({ minLength: 1, maxLength: 500 }),
    mediaType: Type.Literal("text/csv; charset=utf-8"),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    byteSize: Type.Integer({ minimum: 1, maximum: 5_000_000 }),
    sourceDataFreshAt: DateTime,
    content: Type.String({ minLength: 1, maxLength: 5_000_000 }),
  },
  { additionalProperties: false },
);

export const CrmSettingCodeSchema = Type.Union([
  Type.Literal("crm.communication.policy"),
  Type.Literal("crm.dashboard.policy"),
  Type.Literal("crm.report.policy"),
]);
export const SettingParamsSchema = Type.Object(
  { settingCode: CrmSettingCodeSchema },
  { additionalProperties: false },
);

export const CommunicationPolicyConfigSchema = Type.Object(
  {
    maxRecipientsPerDraft: Type.Integer({ minimum: 1, maximum: 500 }),
    requiresFourEyes: Type.Literal(true),
    enabledChannels: Type.Array(CommunicationChannelSchema, {
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export const DashboardPolicyConfigSchema = Type.Object(
  { overdueWarningHours: Type.Integer({ minimum: 1, maximum: 720 }) },
  { additionalProperties: false },
);
export const ReportPolicyConfigSchema = Type.Object(
  {
    retentionDays: Type.Integer({ minimum: 1, maximum: 3_650 }),
    allowedTimezones: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export const SettingConfigSchema = Type.Union([
  CommunicationPolicyConfigSchema,
  DashboardPolicyConfigSchema,
  ReportPolicyConfigSchema,
]);

export const UpdateSettingBodySchema = Type.Object(
  {
    config: SettingConfigSchema,
    activate: Type.Optional(Type.Boolean()),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const SettingVersionSchema = Type.Object(
  {
    id: Identifier,
    settingCode: CrmSettingCodeSchema,
    schemaVersion: Type.String({ minLength: 1, maxLength: 160 }),
    version: Version,
    config: JsonObject,
    state: Type.Union([Type.Literal("draft"), Type.Literal("active"), Type.Literal("retired")]),
    reason: Type.String(),
    createdByUserAccountId: Uuid,
    activatedAt: NullableDateTime,
    createdAt: DateTime,
  },
  { additionalProperties: false },
);

export type CreateCommunicationDraftBody = Static<typeof CreateCommunicationDraftBodySchema>;
export type UpdateCommunicationDraftBody = Static<typeof UpdateCommunicationDraftBodySchema>;
export type ConfirmCommunicationDraftBody = Static<typeof ConfirmCommunicationDraftBodySchema>;
export type QueueCommunicationBody = Static<typeof QueueCommunicationBodySchema>;
export type CommunicationDraft = Static<typeof CommunicationDraftSchema>;
export type DashboardSummaryQuery = Static<typeof DashboardSummaryQuerySchema>;
export type DashboardSummary = Static<typeof DashboardSummarySchema>;
export type Notification = Static<typeof NotificationSchema>;
export type NotificationListQuery = Static<typeof NotificationListQuerySchema>;
export type RunReportBody = Static<typeof RunReportBodySchema>;
export type ReportRun = Static<typeof ReportRunSchema>;
export type ReportExport = Static<typeof ReportExportSchema>;
export type ReportRunListQuery = Static<typeof ReportRunListQuerySchema>;
export type SettingConfig = Static<typeof SettingConfigSchema>;
export type UpdateSettingBody = Static<typeof UpdateSettingBodySchema>;
export type SettingVersion = Static<typeof SettingVersionSchema>;
