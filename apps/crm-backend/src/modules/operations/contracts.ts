import { type Static, Type } from "@sinclair/typebox";

export const MigrationRunStates = [
  "created",
  "profiling",
  "dry_running",
  "awaiting_conflicts",
  "ready_for_rehearsal",
  "rehearsing",
  "ready_for_cutover",
  "cutting_over",
  "completed",
  "failed",
  "rolled_back",
  "cancelled",
] as const;

export const MigrationConflictStates = [
  "open",
  "assigned",
  "resolved",
  "rejected",
  "waived",
  "superseded",
] as const;

const CursorQueryFields = {
  cursor: Type.Optional(Type.String({ minLength: 16, maxLength: 4096 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
};

export const MigrationRunListQuerySchema = Type.Object(
  {
    ...CursorQueryFields,
    state: Type.Optional(Type.Union(MigrationRunStates.map((state) => Type.Literal(state)))),
    mode: Type.Optional(Type.Union([Type.Literal("dry-run"), Type.Literal("import")])),
  },
  { additionalProperties: false },
);

export const MigrationRunParamsSchema = Type.Object(
  {
    runId: Type.String({ minLength: 4, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }),
  },
  { additionalProperties: false },
);

const OutcomeCountsSchema = Type.Object(
  {
    migrated: Type.Integer({ minimum: 0 }),
    linkedExisting: Type.Integer({ minimum: 0 }),
    excludedWithReason: Type.Integer({ minimum: 0 }),
    conflictRecorded: Type.Integer({ minimum: 0 }),
    quarantined: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MigrationRunSchema = Type.Object(
  {
    publicId: Type.String(),
    sourceSystem: Type.Literal("bitrix"),
    snapshotSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    manifestVersion: Type.String(),
    transformVersion: Type.String(),
    state: Type.Union(MigrationRunStates.map((state) => Type.Literal(state))),
    mode: Type.Union([Type.Literal("dry-run"), Type.Literal("import"), Type.Null()]),
    startedAt: Type.String({ format: "date-time" }),
    finishedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    expectedRows: Type.Integer({ minimum: 0 }),
    processedRows: Type.Integer({ minimum: 0 }),
    alreadyAppliedRows: Type.Integer({ minimum: 0 }),
    outcomeCounts: OutcomeCountsSchema,
    blockerCodes: Type.Array(Type.String({ pattern: "^[A-Z0-9_]{1,128}$" }), { maxItems: 256 }),
  },
  { additionalProperties: false },
);

const PageSchema = <T extends ReturnType<typeof Type.Object>>(item: T) =>
  Type.Object(
    {
      items: Type.Array(item),
      page: Type.Object(
        {
          limit: Type.Integer({ minimum: 1, maximum: 200 }),
          nextCursor: Type.Union([Type.String(), Type.Null()]),
          hasMore: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );

export const MigrationRunPageSchema = PageSchema(MigrationRunSchema);

export const MigrationConflictListQuerySchema = Type.Object(
  {
    ...CursorQueryFields,
    runId: Type.Optional(Type.String({ minLength: 4, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" })),
    state: Type.Optional(Type.Union(MigrationConflictStates.map((state) => Type.Literal(state)))),
    severity: Type.Optional(Type.Union([Type.Literal("blocking"), Type.Literal("warning")])),
  },
  { additionalProperties: false },
);

export const MigrationConflictParamsSchema = Type.Object(
  { conflictId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
);

export const MigrationConflictSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    runId: Type.String(),
    conflictType: Type.String({ pattern: "^[A-Za-z0-9_.:-]{1,128}$" }),
    sourceTable: Type.String({ pattern: "^[A-Za-z0-9_]+$" }),
    sourceKeyDigest: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
    severity: Type.Union([Type.Literal("blocking"), Type.Literal("warning")]),
    state: Type.Union(MigrationConflictStates.map((state) => Type.Literal(state))),
    reasonCode: Type.String({ pattern: "^[A-Z0-9_]{1,128}$" }),
    resolutionPresent: Type.Boolean(),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    resolvedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const MigrationConflictPageSchema = PageSchema(MigrationConflictSchema);

export const AuditEventListQuerySchema = Type.Object(
  {
    ...CursorQueryFields,
    eventType: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.:-]+$" })),
    actorType: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.:-]+$" })),
    subjectType: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.:-]+$" })),
    from: Type.Optional(Type.String({ format: "date-time" })),
    to: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);

export const AuditEventSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    eventType: Type.String(),
    occurredAt: Type.String({ format: "date-time" }),
    actorType: Type.String(),
    actorInOwnScope: Type.Boolean(),
    subjectType: Type.String(),
    subjectPresent: Type.Boolean(),
    requestId: Type.Union([Type.String(), Type.Null()]),
    reasonCode: Type.Union([Type.String({ pattern: "^[A-Z0-9_]{1,128}$" }), Type.Null()]),
    policyVersion: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    hasBeforeState: Type.Boolean(),
    hasAfterState: Type.Boolean(),
    eventHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    previousHashPresent: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuditEventPageSchema = PageSchema(AuditEventSchema);

export const PrometheusMetricsSchema = Type.String({
  contentMediaType: "text/plain; version=0.0.4",
});

export type MigrationRunListQuery = Static<typeof MigrationRunListQuerySchema>;
export type MigrationRun = Static<typeof MigrationRunSchema>;
export type MigrationConflictListQuery = Static<typeof MigrationConflictListQuerySchema>;
export type MigrationConflict = Static<typeof MigrationConflictSchema>;
export type AuditEventListQuery = Static<typeof AuditEventListQuerySchema>;
export type AuditEvent = Static<typeof AuditEventSchema>;
