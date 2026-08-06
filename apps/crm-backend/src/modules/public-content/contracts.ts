import { type Static, Type } from "@sinclair/typebox";
import { ApplicantTypeSchema, VacancySectorSchema } from "../intake/schemas.js";

const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});
const ContentId = Type.String({ format: "uuid" });
const Text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const Reason = Type.String({ minLength: 3, maxLength: 4_000, pattern: "\\S" });
const DateTime = Type.String({ format: "date-time" });
const Version = Type.Integer({ minimum: 1 });

export const ContentStateSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("published"),
  Type.Literal("archived"),
]);

export const VacancyContentInputSchema = Type.Object(
  {
    publicId: Type.Optional(Identifier),
    sector: VacancySectorSchema,
    title: Text(240),
    city: Text(240),
    employer: Text(240),
    salaryText: Text(240),
    summary: Text(4_000),
    responsibilities: Type.Array(Text(1_000), { minItems: 1, maxItems: 50 }),
    requirements: Type.Array(Text(1_000), { minItems: 1, maxItems: 50 }),
    conditions: Type.Array(Text(1_000), { minItems: 1, maxItems: 50 }),
    applicantType: ApplicantTypeSchema,
    sphere: Text(64),
    reason: Reason,
  },
  { additionalProperties: false, $id: "VacancyContentInput" },
);

const StoryAssetPathSchema = Type.String({
  minLength: 1,
  maxLength: 2_048,
  pattern: "^(?:assets/[A-Za-z0-9._/-]+|https://[^\\s]+)$",
});

export const StoryContentInputSchema = Type.Object(
  {
    publicId: Type.Optional(Identifier),
    tone: Type.Union([Type.Literal("berry"), Type.Literal("cyan"), Type.Literal("blue")]),
    filters: Type.Array(Text(64), { maxItems: 30, uniqueItems: true }),
    cardTags: Type.Array(Text(120), { maxItems: 12, uniqueItems: true }),
    ariaLabel: Text(300),
    eyebrow: Text(240),
    title: Text(300),
    person: Text(160),
    route: Text(240),
    avatar: StoryAssetPathSchema,
    avatarAlt: Text(300),
    cardQuote: Text(500),
    quote: Text(2_000),
    tags: Type.Array(Text(120), { maxItems: 20, uniqueItems: true }),
    lead: Text(2_000),
    gallery: Type.Array(
      Type.Object({ src: StoryAssetPathSchema, alt: Text(300) }, { additionalProperties: false }),
      { maxItems: 12 },
    ),
    steps: Type.Array(Text(1_000), { minItems: 1, maxItems: 30 }),
    reason: Reason,
  },
  { additionalProperties: false, $id: "StoryContentInput" },
);

export const ContentRecordMetadataSchema = Type.Object(
  {
    state: ContentStateSchema,
    version: Version,
    publishedAt: Type.Union([DateTime, Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);

export const AdminVacancySchema = Type.Object(
  {
    id: ContentId,
    publicId: Identifier,
    sector: VacancySectorSchema,
    title: Text(240),
    city: Text(240),
    employer: Text(240),
    salaryText: Text(240),
    summary: Text(4_000),
    responsibilities: Type.Array(Text(1_000), { maxItems: 50 }),
    requirements: Type.Array(Text(1_000), { maxItems: 50 }),
    conditions: Type.Array(Text(1_000), { maxItems: 50 }),
    applicantType: ApplicantTypeSchema,
    sphere: Text(64),
    state: ContentStateSchema,
    version: Version,
    publishedAt: Type.Union([DateTime, Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false, $id: "AdminVacancy" },
);

export const PublicStorySchema = Type.Object(
  {
    id: Identifier,
    tone: Type.Union([Type.Literal("berry"), Type.Literal("cyan"), Type.Literal("blue")]),
    filters: Type.Array(Text(64), { maxItems: 30 }),
    cardTags: Type.Array(Text(120), { maxItems: 12 }),
    ariaLabel: Text(300),
    eyebrow: Text(240),
    title: Text(300),
    person: Text(160),
    route: Text(240),
    avatar: StoryAssetPathSchema,
    avatarAlt: Text(300),
    cardQuote: Text(500),
    quote: Text(2_000),
    tags: Type.Array(Text(120), { maxItems: 20 }),
    lead: Text(2_000),
    gallery: Type.Array(
      Type.Object({ src: StoryAssetPathSchema, alt: Text(300) }, { additionalProperties: false }),
      { maxItems: 12 },
    ),
    steps: Type.Array(Text(1_000), { maxItems: 30 }),
  },
  { additionalProperties: false, $id: "PublicStory" },
);

export const AdminStorySchema = Type.Object(
  {
    ...PublicStorySchema.properties,
    id: ContentId,
    publicId: Identifier,
    state: ContentStateSchema,
    version: Version,
    publishedAt: Type.Union([DateTime, Type.Null()]),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false, $id: "AdminStory" },
);

export const ContentListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.Union([
        Type.Integer({ minimum: 1, maximum: 100 }),
        Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
      ]),
    ),
    state: Type.Optional(ContentStateSchema),
  },
  { additionalProperties: false, $id: "ContentListQuery" },
);

export const PublicContentListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.Union([
        Type.Integer({ minimum: 1, maximum: 100 }),
        Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
      ]),
    ),
  },
  { additionalProperties: false, $id: "PublicContentListQuery" },
);

export const ContentPageMetadataSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 100 }),
    nextCursor: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AdminVacancyPageSchema = Type.Object(
  { items: Type.Array(AdminVacancySchema), page: ContentPageMetadataSchema },
  { additionalProperties: false, $id: "AdminVacancyPage" },
);

export const AdminStoryPageSchema = Type.Object(
  { items: Type.Array(AdminStorySchema), page: ContentPageMetadataSchema },
  { additionalProperties: false, $id: "AdminStoryPage" },
);

export const PublicStoryPageSchema = Type.Object(
  {
    items: Type.Array(PublicStorySchema),
    suppressedIds: Type.Array(Identifier, {
      uniqueItems: true,
      description:
        "Managed story identifiers hidden by draft/archive state on this cursor page; clients accumulate them before merging static fallback content",
    }),
    page: ContentPageMetadataSchema,
  },
  { additionalProperties: false, $id: "PublicStoryPage" },
);

export const ContentParamsSchema = Type.Object({ contentId: ContentId }, { additionalProperties: false });

export const ContentCreateHeadersSchema = Type.Object(
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

export const ContentMutationHeadersSchema = Type.Object(
  {
    ...ContentCreateHeadersSchema.properties,
    "if-match": Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: true },
);

export const ContentStateChangeBodySchema = Type.Object(
  { reason: Reason },
  { additionalProperties: false, $id: "ContentStateChangeBody" },
);

export type VacancyContentInput = Static<typeof VacancyContentInputSchema>;
export type StoryContentInput = Static<typeof StoryContentInputSchema>;
export type ContentState = Static<typeof ContentStateSchema>;
export type ContentListQuery = Static<typeof ContentListQuerySchema>;
export type PublicContentListQuery = Static<typeof PublicContentListQuerySchema>;
export type AdminVacancy = Static<typeof AdminVacancySchema>;
export type AdminStory = Static<typeof AdminStorySchema>;
export type PublicStory = Static<typeof PublicStorySchema>;
export type PublicStoryPage = Static<typeof PublicStoryPageSchema>;
