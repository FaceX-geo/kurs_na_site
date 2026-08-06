import { type Static, Type } from "@sinclair/typebox";

const Identifier = Type.String({ minLength: 1, maxLength: 160 });
const Uuid = Type.String({ format: "uuid" });
const DateTime = Type.String({ format: "date-time" });
const DateOnly = Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });
const Reason = Type.String({ minLength: 3, maxLength: 4_000 });
const NullableText = Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()]);

export const CrmCaseCommandParamsSchema = Type.Object(
  { caseId: Identifier },
  { additionalProperties: false },
);
export const CrmReferralCommandParamsSchema = Type.Object(
  { referralId: Identifier },
  { additionalProperties: false },
);
export const CrmTaskCommandParamsSchema = Type.Object(
  { taskId: Identifier },
  { additionalProperties: false },
);

export const CrmMutationHeadersSchema = Type.Object(
  {
    "if-match": Type.String({ minLength: 1, maxLength: 64 }),
    "x-csrf-token": Type.String({ minLength: 16, maxLength: 512 }),
  },
  { additionalProperties: true },
);

export const CrmCreateHeadersSchema = Type.Object(
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

export const UpdateCaseBodySchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    nextStep: Type.Optional(NullableText),
    ownerEmployeeProfileId: Type.Optional(Type.Union([Uuid, Type.Null()])),
    relocation: Type.Optional(
      Type.Object(
        {
          employerId: Type.Optional(Type.Union([Uuid, Type.Null()])),
          position: Type.Optional(NullableText),
          municipality: Type.Optional(NullableText),
          locality: Type.Optional(NullableText),
          plannedDate: Type.Optional(Type.Union([DateOnly, Type.Null()])),
          actualDate: Type.Optional(Type.Union([DateOnly, Type.Null()])),
          offerStatus: Type.Optional(NullableText),
          employmentStatus: Type.Optional(NullableText),
          household: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          supportMeasures: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 100 }),
          ),
          resultCode: Type.Optional(NullableText),
          resultReason: Type.Optional(NullableText),
        },
        { additionalProperties: false },
      ),
    ),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const EmployerContactInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 300 }),
    position: Type.Optional(Type.String({ maxLength: 300 })),
    email: Type.Optional(Type.String({ format: "email", maxLength: 254 })),
    phone: Type.Optional(Type.String({ pattern: "^\\+[1-9][0-9]{7,14}$" })),
    isPrimary: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CreateEmployerBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 500 }),
    legalName: Type.Optional(Type.String({ maxLength: 500 })),
    taxId: Type.Optional(Type.String({ pattern: "^[0-9]{10}([0-9]{2})?$" })),
    organizationType: Type.Union([
      Type.Literal("legal_entity"),
      Type.Literal("branch"),
      Type.Literal("individual_entrepreneur"),
    ]),
    manualReviewReason: Type.Optional(Reason),
    ownerEmployeeProfileId: Type.Optional(Uuid),
    contacts: Type.Optional(Type.Array(EmployerContactInputSchema, { maxItems: 100 })),
  },
  { additionalProperties: false },
);

export const CreateReferralBodySchema = Type.Object(
  {
    caseId: Identifier,
    employerId: Identifier,
    ownerEmployeeProfileId: Type.Optional(Uuid),
    channelCode: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
    vacancyTitle: Type.Optional(Type.String({ maxLength: 500 })),
    comment: Type.Optional(Type.String({ maxLength: 4_000 })),
  },
  { additionalProperties: false },
);

export const TransitionReferralBodySchema = Type.Object(
  {
    toStageCode: Type.Union([
      Type.Literal("on_review"),
      Type.Literal("accepted"),
      Type.Literal("rejected_by_employer"),
      Type.Literal("rejected_by_candidate"),
      Type.Literal("cancelled"),
    ]),
    reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
    reasonText: Type.Optional(Reason),
  },
  { additionalProperties: false },
);

export const TaskChecklistInputSchema = Type.Object(
  { title: Type.String({ minLength: 1, maxLength: 500 }), completed: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const CreateTaskBodySchema = Type.Object(
  {
    caseId: Type.Optional(Identifier),
    employerReferralId: Type.Optional(Identifier),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 10_000 })),
    responsibleEmployeeProfileId: Uuid,
    participantEmployeeProfileIds: Type.Optional(Type.Array(Uuid, { maxItems: 100, uniqueItems: true })),
    dueAt: Type.Optional(DateTime),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    priority: Type.Optional(
      Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("urgent")]),
    ),
    checklist: Type.Optional(Type.Array(TaskChecklistInputSchema, { maxItems: 200 })),
  },
  { additionalProperties: false },
);

export const UpdateTaskBodySchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    description: Type.Optional(NullableText),
    responsibleEmployeeProfileId: Type.Optional(Uuid),
    participantEmployeeProfileIds: Type.Optional(Type.Array(Uuid, { maxItems: 100, uniqueItems: true })),
    dueAt: Type.Optional(Type.Union([DateTime, Type.Null()])),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    priority: Type.Optional(
      Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("urgent")]),
    ),
    checklist: Type.Optional(Type.Array(TaskChecklistInputSchema, { maxItems: 200 })),
    reason: Reason,
  },
  { additionalProperties: false },
);

export type UpdateCaseBody = Static<typeof UpdateCaseBodySchema>;
export type CreateEmployerBody = Static<typeof CreateEmployerBodySchema>;
export type CreateReferralBody = Static<typeof CreateReferralBodySchema>;
export type TransitionReferralBody = Static<typeof TransitionReferralBodySchema>;
export type CreateTaskBody = Static<typeof CreateTaskBodySchema>;
export type UpdateTaskBody = Static<typeof UpdateTaskBodySchema>;
