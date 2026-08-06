import { type Static, Type } from "@sinclair/typebox";
import { UPLOAD_STORAGE_CEILING_BYTES } from "../../common/upload-policy.js";

const TrimmedString = (options: Record<string, unknown> = {}) => Type.String({ minLength: 1, ...options });

const NullableString = (options: Record<string, unknown> = {}) =>
  Type.Union([Type.String(options), Type.Null()]);

export const ApplicantTypeSchema = Type.Union([Type.Literal("relocation"), Type.Literal("student")]);

export const SphereSchema = Type.Object(
  {
    value: TrimmedString({ maxLength: 64 }),
    label: TrimmedString({ maxLength: 160 }),
  },
  { additionalProperties: false, $id: "PublicSphere" },
);

export const SphereListSchema = Type.Object(
  { items: Type.Array(SphereSchema) },
  { additionalProperties: false, $id: "PublicSphereList" },
);

export const MapPointSchema = Type.Object(
  {
    id: TrimmedString({ maxLength: 128 }),
    name: TrimmedString({ maxLength: 200 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    eyebrow: Type.Optional(Type.String({ maxLength: 160 })),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    sectors: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 50 }),
    source: Type.Optional(Type.String({ maxLength: 2_048 })),
    nudgeX: Type.Optional(Type.Number({ minimum: -1_000, maximum: 1_000 })),
    nudgeY: Type.Optional(Type.Number({ minimum: -1_000, maximum: 1_000 })),
    labelOffsetX: Type.Optional(Type.Number({ minimum: -1_000, maximum: 1_000 })),
    labelOffsetY: Type.Optional(Type.Number({ minimum: -1_000, maximum: 1_000 })),
    status: Type.Literal("published"),
  },
  { additionalProperties: false, $id: "PublicMapPoint" },
);

export const MapPointListSchema = Type.Object(
  { items: Type.Array(MapPointSchema) },
  { additionalProperties: false, $id: "PublicMapPointList" },
);

export const VacancySectorSchema = Type.Union([
  Type.Literal("industry"),
  Type.Literal("medicine"),
  Type.Literal("education"),
  Type.Literal("port"),
  Type.Literal("safety"),
  Type.Literal("students"),
]);

export const VacancySchema = Type.Object(
  {
    id: TrimmedString({ maxLength: 128 }),
    sector: VacancySectorSchema,
    title: TrimmedString({ maxLength: 240 }),
    city: TrimmedString({ maxLength: 240 }),
    employer: TrimmedString({ maxLength: 240 }),
    salaryText: TrimmedString({ maxLength: 240 }),
    summary: TrimmedString({ maxLength: 4_000 }),
    responsibilities: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      maxItems: 50,
    }),
    requirements: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      maxItems: 50,
    }),
    conditions: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      maxItems: 50,
    }),
    applicantType: ApplicantTypeSchema,
    sphere: Type.String({ maxLength: 64 }),
    published: Type.Literal(true),
  },
  { additionalProperties: false, $id: "PublicVacancy" },
);

export const VacancyQuerySchema = Type.Object(
  {
    sector: Type.Optional(VacancySectorSchema),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.Union([
        Type.Integer({ minimum: 1, maximum: 100 }),
        Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$", maxLength: 3 }),
      ]),
    ),
  },
  { additionalProperties: false, $id: "PublicVacancyQuery" },
);

export const CursorPageSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 100 }),
    nextCursor: NullableString({ maxLength: 512 }),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false, $id: "PublicCursorPage" },
);

export const VacancyPageSchema = Type.Object(
  {
    items: Type.Array(VacancySchema),
    page: CursorPageSchema,
  },
  { additionalProperties: false, $id: "PublicVacancyPage" },
);

export const IdempotencyHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
    }),
  },
  { additionalProperties: true, $id: "PublicIdempotencyHeaders" },
);

const PersonalSchema = Type.Object(
  {
    surname: TrimmedString({ maxLength: 120 }),
    name: TrimmedString({ maxLength: 120 }),
    middlename: Type.Optional(Type.String({ maxLength: 120 })),
    birthdate: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
    email: TrimmedString({ maxLength: 320 }),
    phone: TrimmedString({ maxLength: 64 }),
  },
  { additionalProperties: false },
);

const ApplicationCommonProperties = {
  referralCode: Type.Optional(Type.String({ maxLength: 64 })),
  region: TrimmedString({ maxLength: 240 }),
  comment: Type.Optional(Type.String({ maxLength: 8_000 })),
  vacancyId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  vacancySector: Type.Optional(VacancySectorSchema),
};

const RelocationApplicationSchema = Type.Object(
  {
    applicantType: Type.Literal("relocation"),
    ...ApplicationCommonProperties,
    sphere: TrimmedString({ maxLength: 64 }),
    wishPost: TrimmedString({ maxLength: 240 }),
    wishSalary: Type.Optional(
      Type.Union([Type.String({ maxLength: 24 }), Type.Integer({ minimum: 0, maximum: 1_000_000_000 })]),
    ),
  },
  { additionalProperties: false },
);

const StudentStatusSchema = Type.Union([
  Type.Literal("1"),
  Type.Literal("2"),
  Type.Literal("3"),
  Type.Literal("4"),
  Type.Literal("5"),
  Type.Literal("6"),
  Type.Literal("graduated"),
]);

const PracticePeriodSchema = Type.Object(
  {
    start: Type.String({ pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }),
    end: Type.String({ pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }),
  },
  { additionalProperties: false },
);

const StudentProfileSchema = Type.Object(
  {
    institution: TrimmedString({ maxLength: 320 }),
    specialty: TrimmedString({ maxLength: 320 }),
    graduationYear: Type.Integer({ minimum: 1950, maximum: 2200 }),
    status: StudentStatusSchema,
    practicePeriod: Type.Optional(PracticePeriodSchema),
  },
  { additionalProperties: false },
);

const StudentApplicationSchema = Type.Object(
  {
    applicantType: Type.Literal("student"),
    ...ApplicationCommonProperties,
    studentProfile: StudentProfileSchema,
  },
  { additionalProperties: false },
);

const ConsentSchema = Type.Object(
  {
    privacyAccepted: Type.Literal(true),
    privacyPolicyVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    acceptedAt: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);

const CanonicalConsentEvidenceSchema = Type.Object(
  {
    privacyAccepted: Type.Literal(true),
    privacyPolicyVersion: Type.String({ minLength: 1, maxLength: 128 }),
    acceptedAt: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const AttachmentsSchema = Type.Object(
  {
    resumeFileId: Type.String({ minLength: 1, maxLength: 160 }),
    resumeFileBindingToken: Type.Optional(Type.String({ minLength: 32, maxLength: 256 })),
  },
  { additionalProperties: false },
);

const CanonicalAttachmentsSchema = Type.Object(
  {
    resumeFileId: Type.String({ minLength: 1, maxLength: 160 }),
    resumeFileBindingToken: Type.String({ minLength: 32, maxLength: 256 }),
  },
  { additionalProperties: false },
);

const UtmSchema = Type.Object(
  {
    utm_source: Type.Optional(Type.String({ maxLength: 300 })),
    utm_medium: Type.Optional(Type.String({ maxLength: 300 })),
    utm_campaign: Type.Optional(Type.String({ maxLength: 300 })),
    utm_content: Type.Optional(Type.String({ maxLength: 300 })),
    utm_term: Type.Optional(Type.String({ maxLength: 300 })),
  },
  { additionalProperties: false },
);

const ClickIdsSchema = Type.Object(
  {
    yclid: Type.Optional(Type.String({ maxLength: 512 })),
    gclid: Type.Optional(Type.String({ maxLength: 512 })),
    vkClickId: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

const AttributionTouchSchema = Type.Object(
  {
    capturedAt: Type.Optional(Type.String({ maxLength: 64 })),
    landingUrl: Type.Optional(Type.String({ maxLength: 2_048 })),
    referrer: Type.Optional(Type.String({ maxLength: 2_048 })),
    utm: Type.Optional(UtmSchema),
    clickIds: Type.Optional(ClickIdsSchema),
  },
  { additionalProperties: false },
);

const EntryPointSchema = Type.Object(
  {
    source: Type.Optional(Type.String({ maxLength: 128 })),
    code: Type.Optional(Type.String({ maxLength: 128 })),
    role: Type.Optional(Type.String({ maxLength: 240 })),
    sphere: Type.Optional(Type.String({ maxLength: 64 })),
    city: Type.Optional(Type.String({ maxLength: 240 })),
    applicantType: Type.Optional(Type.Union([ApplicantTypeSchema, Type.Literal("")])),
    vacancyId: Type.Optional(Type.String({ maxLength: 128 })),
    vacancySector: Type.Optional(Type.Union([VacancySectorSchema, Type.Literal("")])),
  },
  { additionalProperties: false },
);

const LandingSchema = Type.Object(
  {
    host: Type.Optional(Type.String({ maxLength: 253 })),
    path: Type.Optional(Type.String({ maxLength: 2_048 })),
    url: Type.Optional(Type.String({ maxLength: 2_048 })),
  },
  { additionalProperties: false },
);

const MetaSchema = Type.Object(
  {
    source: Type.Optional(Type.String({ maxLength: 128 })),
    entryPoint: Type.Optional(EntryPointSchema),
    utm: Type.Optional(UtmSchema),
    timestamp: Type.Optional(Type.String({ maxLength: 64 })),
    clientFingerprint: Type.Optional(Type.String({ maxLength: 256 })),
    sessionId: Type.Optional(Type.String({ maxLength: 160 })),
    consentState: Type.Optional(Type.Union([Type.Literal("necessary"), Type.Literal("all")])),
    landing: Type.Optional(LandingSchema),
    attribution: Type.Optional(
      Type.Object(
        {
          firstTouch: Type.Optional(AttributionTouchSchema),
          lastTouch: Type.Optional(AttributionTouchSchema),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ApplicationPayloadSchema = Type.Object(
  {
    schemaVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    personal: PersonalSchema,
    application: Type.Union([RelocationApplicationSchema, StudentApplicationSchema]),
    consents: ConsentSchema,
    attachments: AttachmentsSchema,
    meta: Type.Optional(MetaSchema),
  },
  { additionalProperties: false, $id: "PublicApplicationPayload" },
);

export const CanonicalApplicationPayloadSchema = Type.Intersect(
  [
    ApplicationPayloadSchema,
    Type.Object(
      {
        consents: CanonicalConsentEvidenceSchema,
        attachments: CanonicalAttachmentsSchema,
      },
      { additionalProperties: true },
    ),
  ],
  {
    $id: "CanonicalPublicApplicationPayload",
    description:
      "Canonical landing submission. Consent policy version and client acceptance time are mandatory evidence.",
  },
);

export const ApplicationReceiptSchema = Type.Object(
  {
    applicationId: TrimmedString({ maxLength: 160 }),
    status: Type.Literal("received"),
    createdAt: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false, $id: "PublicApplicationReceipt" },
);

export const UploadReceiptSchema = Type.Object(
  {
    fileId: TrimmedString({ maxLength: 160 }),
    bindingToken: Type.String({ minLength: 32, maxLength: 256 }),
    name: TrimmedString({ maxLength: 255 }),
    size: Type.Integer({ minimum: 1, maximum: UPLOAD_STORAGE_CEILING_BYTES }),
    status: Type.Literal("quarantined"),
  },
  { additionalProperties: false, $id: "PublicUploadReceipt" },
);

export const UploadMultipartBodySchema = Type.Object(
  {
    file: Type.String({ format: "binary" }),
  },
  {
    additionalProperties: false,
    $id: "PublicUploadMultipartBody",
    description: "multipart/form-data with a single resume file field",
  },
);

export const ErrorItemSchema = Type.Object(
  {
    field: Type.String({ maxLength: 512 }),
    code: Type.String({ maxLength: 128 }),
    message: Type.String({ maxLength: 2_000 }),
  },
  { additionalProperties: false },
);

export const ErrorResponseSchema = Type.Object(
  {
    code: Type.String({ maxLength: 128 }),
    message: Type.String({ maxLength: 2_000 }),
    requestId: Type.String({ maxLength: 256 }),
    errors: Type.Array(ErrorItemSchema),
  },
  { additionalProperties: false, $id: "PublicError" },
);

export type Sphere = Static<typeof SphereSchema>;
export type MapPoint = Static<typeof MapPointSchema>;
export type Vacancy = Static<typeof VacancySchema>;
export type VacancyQuery = Static<typeof VacancyQuerySchema>;
export type VacancyPage = Static<typeof VacancyPageSchema>;
export type ApplicationPayload = Static<typeof ApplicationPayloadSchema>;
export type ApplicationReceipt = Static<typeof ApplicationReceiptSchema>;
export type UploadReceipt = Static<typeof UploadReceiptSchema>;
export type IdempotencyHeaders = Static<typeof IdempotencyHeadersSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
