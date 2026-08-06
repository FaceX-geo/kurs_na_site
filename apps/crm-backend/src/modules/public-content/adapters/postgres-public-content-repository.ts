import { createHash } from "node:crypto";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Kysely, Transaction } from "kysely";
import { AppError } from "../../../common/errors.js";
import { newUuid } from "../../../common/id.js";
import { decodeCursor, encodeCursor, type Page } from "../../../common/pagination.js";
import type { Database } from "../../../db/types.js";
import { appendAuditEvent } from "../../platform/audit.js";
import type {
  AdminStory,
  AdminVacancy,
  ContentListQuery,
  ContentState,
  PublicContentListQuery,
  PublicStory,
  PublicStoryPage,
  StoryContentInput,
  VacancyContentInput,
} from "../contracts.js";
import { AdminStorySchema, AdminVacancySchema } from "../contracts.js";
import type {
  ContentKind,
  ContentMutationContext,
  ContentMutationResult,
  PublicContentRepositoryPort,
} from "../ports.js";

type ContentTransaction = Transaction<Database>;

type VacancyDocument = Omit<VacancyContentInput, "publicId" | "reason">;
type StoryDocument = Omit<StoryContentInput, "publicId" | "reason">;

interface StoredContentRow {
  id: string;
  public_id: string;
  document: unknown;
  publication_state: string;
  version: number;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

type IdempotencyClaim =
  | { readonly state: "claimed" }
  | {
      readonly state: "replayed";
      readonly resourceId: string;
      readonly responseBody: unknown;
      readonly responseStatus: number;
    };

const CONTENT_ROW_COLUMNS = [
  "id",
  "public_id",
  "document",
  "publication_state",
  "version",
  "published_at",
  "created_at",
  "updated_at",
] as const;

function withoutFormats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutFormats);
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.format;
  for (const [key, child] of Object.entries(copy)) copy[key] = withoutFormats(child);
  return copy;
}

const AdminVacancyReplaySchema = withoutFormats(AdminVacancySchema) as TSchema;
const AdminStoryReplaySchema = withoutFormats(AdminStorySchema) as TSchema;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function requestHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function idempotencyRequestHash(input: {
  readonly operation: string;
  readonly actorUserAccountId: string;
  readonly resourceId: string | null;
  readonly expectedVersion: number | null;
  readonly payload: unknown;
}): string {
  return requestHash(input);
}

function idempotencyScope(operation: string, actorUserAccountId: string): string {
  return `${operation}:${actorUserAccountId}`;
}

function replayValue<T extends { readonly id: string }>(
  claim: Extract<IdempotencyClaim, { readonly state: "replayed" }>,
  schema: TSchema,
  expectedStatus: number,
  expectedResourceId?: string,
): T {
  const candidate = claim.responseBody as {
    readonly id?: unknown;
    readonly publishedAt?: unknown;
    readonly createdAt?: unknown;
    readonly updatedAt?: unknown;
  };
  if (
    claim.responseStatus !== expectedStatus ||
    !Value.Check(schema, claim.responseBody) ||
    typeof candidate.id !== "string" ||
    !UUID_PATTERN.test(candidate.id) ||
    (candidate.publishedAt !== null && !isCanonicalIsoTimestamp(candidate.publishedAt)) ||
    !isCanonicalIsoTimestamp(candidate.createdAt) ||
    !isCanonicalIsoTimestamp(candidate.updatedAt) ||
    (expectedResourceId !== undefined && claim.resourceId !== expectedResourceId)
  ) {
    throw new Error("Stored public-content idempotency response is invalid");
  }
  const value = claim.responseBody as T;
  if (value.id !== claim.resourceId) {
    throw new Error("Stored public-content idempotency response binding is invalid");
  }
  return value;
}

function asIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function generatedPublicId(kind: ContentKind): string {
  return `${kind === "vacancy" ? "vac" : "story"}_${newUuid().replaceAll("-", "")}`;
}

function normalizedText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError(422, "content_blank_text", "Текстовое поле не может быть пустым", {
      errors: [{ field, code: "non_blank", message: "Заполните поле" }],
    });
  }
  return normalized;
}

function normalizedTextArray(values: readonly string[], field: string, requireItem = false): string[] {
  const normalized = values.map((value, index) => normalizedText(value, `${field}.${index}`));
  if (requireItem && normalized.length === 0) {
    throw new AppError(422, "content_empty_list", "Список не может быть пустым", {
      errors: [{ field, code: "min_items", message: "Добавьте хотя бы один пункт" }],
    });
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new AppError(422, "content_duplicate_list_item", "Список содержит повторяющиеся пункты", {
      errors: [{ field, code: "unique_items", message: "Удалите повторяющиеся пункты" }],
    });
  }
  return normalized;
}

function normalizedStoryAsset(value: string, field: string): string {
  if (value !== value.trim()) {
    throw new AppError(422, "invalid_story_asset", "Некорректный путь медиафайла", {
      errors: [{ field, code: "invalid_asset", message: "Уберите пробелы вокруг пути" }],
    });
  }
  if (value.startsWith("assets/")) {
    const segments = value.slice("assets/".length).split("/");
    if (segments.length > 0 && segments.every((segment) => segment && segment !== "." && segment !== "..")) {
      return value;
    }
  } else {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password) return value;
    } catch {
      // The transport schema reports the field; this is the repository defence-in-depth branch.
    }
  }
  throw new AppError(422, "invalid_story_asset", "Некорректный путь медиафайла", {
    errors: [{ field, code: "invalid_asset", message: "Используйте безопасный assets/ путь или HTTPS URL" }],
  });
}

function normalizedReason(reason: string): string {
  return normalizedText(reason, "reason");
}

function vacancyDocument(input: VacancyContentInput): VacancyDocument {
  return {
    sector: input.sector,
    title: normalizedText(input.title, "title"),
    city: normalizedText(input.city, "city"),
    employer: normalizedText(input.employer, "employer"),
    salaryText: normalizedText(input.salaryText, "salaryText"),
    summary: normalizedText(input.summary, "summary"),
    responsibilities: normalizedTextArray(input.responsibilities, "responsibilities", true),
    requirements: normalizedTextArray(input.requirements, "requirements", true),
    conditions: normalizedTextArray(input.conditions, "conditions", true),
    applicantType: input.applicantType,
    sphere: normalizedText(input.sphere, "sphere"),
  };
}

function storyDocument(input: StoryContentInput): StoryDocument {
  return {
    tone: input.tone,
    filters: normalizedTextArray(input.filters, "filters"),
    cardTags: normalizedTextArray(input.cardTags, "cardTags"),
    ariaLabel: normalizedText(input.ariaLabel, "ariaLabel"),
    eyebrow: normalizedText(input.eyebrow, "eyebrow"),
    title: normalizedText(input.title, "title"),
    person: normalizedText(input.person, "person"),
    route: normalizedText(input.route, "route"),
    avatar: normalizedStoryAsset(input.avatar, "avatar"),
    avatarAlt: normalizedText(input.avatarAlt, "avatarAlt"),
    cardQuote: normalizedText(input.cardQuote, "cardQuote"),
    quote: normalizedText(input.quote, "quote"),
    tags: normalizedTextArray(input.tags, "tags"),
    lead: normalizedText(input.lead, "lead"),
    gallery: input.gallery.map((item, index) => ({
      src: normalizedStoryAsset(item.src, `gallery.${index}.src`),
      alt: normalizedText(item.alt, `gallery.${index}.alt`),
    })),
    steps: normalizedTextArray(input.steps, "steps", true),
  };
}

function mapVacancy(row: StoredContentRow): AdminVacancy {
  const document = row.document as VacancyDocument;
  return {
    id: row.id,
    publicId: row.public_id,
    ...document,
    state: row.publication_state as ContentState,
    version: Number(row.version),
    publishedAt: row.published_at ? asIso(row.published_at) : null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function mapStory(row: StoredContentRow): AdminStory {
  const document = row.document as StoryDocument;
  return {
    id: row.id,
    publicId: row.public_id,
    ...document,
    state: row.publication_state as ContentState,
    version: Number(row.version),
    publishedAt: row.published_at ? asIso(row.published_at) : null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function publicStory(story: AdminStory): PublicStory {
  return {
    id: story.publicId,
    tone: story.tone,
    filters: story.filters,
    cardTags: story.cardTags,
    ariaLabel: story.ariaLabel,
    eyebrow: story.eyebrow,
    title: story.title,
    person: story.person,
    route: story.route,
    avatar: story.avatar,
    avatarAlt: story.avatarAlt,
    cardQuote: story.cardQuote,
    quote: story.quote,
    tags: story.tags,
    lead: story.lead,
    gallery: story.gallery,
    steps: story.steps,
  };
}

export interface PostgresPublicContentRepositoryOptions {
  readonly cursorSigningKey: string;
  readonly idempotencyTtlSeconds: number;
}

export class PostgresPublicContentRepository implements PublicContentRepositoryPort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: PostgresPublicContentRepositoryOptions,
  ) {}

  async listVacancies(query: ContentListQuery): Promise<Page<AdminVacancy>> {
    return this.list("content.vacancy", query, mapVacancy);
  }

  async listStories(query: ContentListQuery): Promise<Page<AdminStory>> {
    return this.list("content.story", query, mapStory);
  }

  async listPublicStories(query: PublicContentListQuery): Promise<PublicStoryPage> {
    const limit = typeof query.limit === "string" ? Number(query.limit) : (query.limit ?? 50);
    const signingKey = this.cursorKey("content.story", "public-all-states");
    const cursor = decodeCursor(query.cursor, signingKey);
    let statement = this.db
      .selectFrom("content.story")
      .select([
        "id",
        "public_id",
        "document",
        "publication_state",
        "version",
        "published_at",
        "created_at",
        "updated_at",
      ]);
    if (cursor) {
      const at = new Date(cursor.createdAt);
      statement = statement.where((expression) =>
        expression.or([
          expression("created_at", "<", at),
          expression.and([expression("created_at", "=", at), expression("id", "<", cursor.id)]),
        ]),
      );
    }
    const rows = (await statement
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute()) as StoredContentRow[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows
        .filter((row) => row.publication_state === "published")
        .map((row) => publicStory(mapStory(row))),
      suppressedIds: pageRows
        .filter((row) => row.publication_state !== "published")
        .map((row) => row.public_id),
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: asIso(last.created_at), id: last.id }, signingKey)
            : null,
      },
    };
  }

  async createVacancy(
    context: ContentMutationContext,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>> {
    return this.create(
      "vacancy",
      "content.vacancy",
      context,
      input.publicId,
      vacancyDocument(input),
      input.reason,
      mapVacancy,
      AdminVacancyReplaySchema,
    );
  }

  async updateVacancy(
    context: ContentMutationContext,
    contentId: string,
    input: VacancyContentInput,
  ): Promise<ContentMutationResult<AdminVacancy>> {
    return this.update(
      "vacancy",
      "content.vacancy",
      context,
      contentId,
      input.publicId,
      vacancyDocument(input),
      input.reason,
      mapVacancy,
      AdminVacancyReplaySchema,
    );
  }

  async setVacancyState(
    context: ContentMutationContext,
    contentId: string,
    state: ContentState,
    reason: string,
  ): Promise<ContentMutationResult<AdminVacancy>> {
    return this.setState(
      "vacancy",
      "content.vacancy",
      context,
      contentId,
      state,
      reason,
      mapVacancy,
      AdminVacancyReplaySchema,
    );
  }

  async createStory(
    context: ContentMutationContext,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>> {
    return this.create(
      "story",
      "content.story",
      context,
      input.publicId,
      storyDocument(input),
      input.reason,
      mapStory,
      AdminStoryReplaySchema,
    );
  }

  async updateStory(
    context: ContentMutationContext,
    contentId: string,
    input: StoryContentInput,
  ): Promise<ContentMutationResult<AdminStory>> {
    return this.update(
      "story",
      "content.story",
      context,
      contentId,
      input.publicId,
      storyDocument(input),
      input.reason,
      mapStory,
      AdminStoryReplaySchema,
    );
  }

  async setStoryState(
    context: ContentMutationContext,
    contentId: string,
    state: ContentState,
    reason: string,
  ): Promise<ContentMutationResult<AdminStory>> {
    return this.setState(
      "story",
      "content.story",
      context,
      contentId,
      state,
      reason,
      mapStory,
      AdminStoryReplaySchema,
    );
  }

  private async list<T>(
    table: "content.vacancy" | "content.story",
    query: ContentListQuery,
    mapper: (row: StoredContentRow) => T,
  ): Promise<Page<T>> {
    const limit = typeof query.limit === "string" ? Number(query.limit) : (query.limit ?? 50);
    const signingKey = this.cursorKey(table, `admin:${query.state ?? "active"}`);
    const cursor = decodeCursor(query.cursor, signingKey);
    let statement = this.db
      .selectFrom(table)
      .select([
        "id",
        "public_id",
        "document",
        "publication_state",
        "version",
        "published_at",
        "created_at",
        "updated_at",
      ]);
    if (query.state === "archived") {
      statement = statement.where("publication_state", "=", "archived");
    } else {
      statement = statement.where("archived_at", "is", null);
    }
    if (query.state && query.state !== "archived") {
      statement = statement.where("publication_state", "=", query.state);
    }
    if (cursor) {
      const at = new Date(cursor.createdAt);
      statement = statement.where((expression) =>
        expression.or([
          expression("created_at", "<", at),
          expression.and([expression("created_at", "=", at), expression("id", "<", cursor.id)]),
        ]),
      );
    }
    const rows = await statement
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit) as StoredContentRow[];
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapper),
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: asIso(last.created_at), id: last.id }, signingKey)
            : null,
      },
    };
  }

  private cursorKey(table: "content.vacancy" | "content.story", view: string): string {
    return `${this.options.cursorSigningKey}\u0000public-content\u0000${table}\u0000${view}`;
  }

  private async create<T extends { readonly id: string }>(
    kind: ContentKind,
    table: "content.vacancy" | "content.story",
    context: ContentMutationContext,
    requestedPublicId: string | undefined,
    document: VacancyDocument | StoryDocument,
    reason: string,
    mapper: (row: StoredContentRow) => T,
    responseSchema: TSchema,
  ): Promise<ContentMutationResult<T>> {
    const normalizedChangeReason = normalizedReason(reason);
    const operation = `content.${kind}.create`;
    const scope = idempotencyScope(operation, context.actor.auth.userAccountId);
    const hash = idempotencyRequestHash({
      operation,
      actorUserAccountId: context.actor.auth.userAccountId,
      resourceId: requestedPublicId ?? null,
      expectedVersion: null,
      payload: { document, publicId: requestedPublicId ?? null, reason: normalizedChangeReason },
    });
    return this.db.transaction().execute(async (transaction) => {
      const claim = await this.claimIdempotency(transaction, scope, context.idempotencyKey, hash);
      if (claim.state === "replayed") {
        return {
          value: replayValue<T>(claim, responseSchema, 201),
          replayed: true,
        };
      }
      const now = new Date();
      const id = newUuid();
      const publicId = requestedPublicId ?? generatedPublicId(kind);
      const inserted = (await transaction
        .insertInto(table)
        .values({
          id,
          public_id: publicId,
          document,
          publication_state: "draft",
          version: 1,
          published_at: null,
          created_by: context.actor.auth.userAccountId,
          updated_by: context.actor.auth.userAccountId,
          created_at: now,
          updated_at: now,
          archived_at: null,
        })
        .onConflict((conflict) => conflict.column("public_id").doNothing())
        .returning(CONTENT_ROW_COLUMNS)
        .executeTakeFirst()) as StoredContentRow | undefined;
      if (!inserted) {
        throw new AppError(409, "content_public_id_conflict", "Публичный идентификатор уже используется");
      }
      await this.recordChange(
        transaction,
        kind,
        inserted.id,
        1,
        document,
        "draft",
        context,
        normalizedChangeReason,
        "created",
        now,
      );
      const value = mapper(inserted);
      await this.completeIdempotency(
        transaction,
        scope,
        context.idempotencyKey,
        hash,
        inserted.id,
        201,
        value,
      );
      return { value, replayed: false };
    });
  }

  private async update<T extends { readonly id: string }>(
    kind: ContentKind,
    table: "content.vacancy" | "content.story",
    context: ContentMutationContext,
    contentId: string,
    requestedPublicId: string | undefined,
    document: VacancyDocument | StoryDocument,
    reason: string,
    mapper: (row: StoredContentRow) => T,
    responseSchema: TSchema,
  ): Promise<ContentMutationResult<T>> {
    const expectedVersion = context.expectedVersion ?? 0;
    const normalizedChangeReason = normalizedReason(reason);
    const operation = `content.${kind}.update`;
    const scope = idempotencyScope(operation, context.actor.auth.userAccountId);
    const hash = idempotencyRequestHash({
      operation,
      actorUserAccountId: context.actor.auth.userAccountId,
      resourceId: contentId,
      expectedVersion,
      payload: {
        document,
        publicId: requestedPublicId ?? null,
        reason: normalizedChangeReason,
      },
    });
    return this.db.transaction().execute(async (transaction) => {
      const claim = await this.claimIdempotency(transaction, scope, context.idempotencyKey, hash);
      if (claim.state === "replayed") {
        return {
          value: replayValue<T>(claim, responseSchema, 200, contentId),
          replayed: true,
        };
      }
      const current = await transaction
        .selectFrom(table)
        .selectAll()
        .where("id", "=", contentId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new AppError(404, "content_not_found", "Материал не найден");
      if (current.archived_at || current.publication_state === "archived") {
        throw new AppError(409, "content_archived", "Архивный материал нельзя изменить");
      }
      if (requestedPublicId && requestedPublicId !== current.public_id) {
        throw new AppError(409, "content_public_id_immutable", "Публичный идентификатор нельзя изменить");
      }
      if (Number(current.version) !== expectedVersion) {
        throw new AppError(409, "version_conflict", "Материал был изменён", {
          details: { expectedVersion, currentVersion: Number(current.version) },
        });
      }
      const now = new Date();
      const version = expectedVersion + 1;
      const updated = (await transaction
        .updateTable(table)
        .set({ document, version, updated_by: context.actor.auth.userAccountId, updated_at: now })
        .where("id", "=", contentId)
        .where("version", "=", expectedVersion)
        .returning(CONTENT_ROW_COLUMNS)
        .executeTakeFirst()) as StoredContentRow | undefined;
      if (!updated) throw new Error("Could not update public content row");
      await this.recordChange(
        transaction,
        kind,
        contentId,
        version,
        document,
        current.publication_state as ContentState,
        context,
        normalizedChangeReason,
        "updated",
        now,
      );
      const value = mapper(updated);
      await this.completeIdempotency(transaction, scope, context.idempotencyKey, hash, contentId, 200, value);
      return { value, replayed: false };
    });
  }

  private async setState<T extends { readonly id: string }>(
    kind: ContentKind,
    table: "content.vacancy" | "content.story",
    context: ContentMutationContext,
    contentId: string,
    state: ContentState,
    reason: string,
    mapper: (row: StoredContentRow) => T,
    responseSchema: TSchema,
  ): Promise<ContentMutationResult<T>> {
    const expectedVersion = context.expectedVersion ?? 0;
    const normalizedChangeReason = normalizedReason(reason);
    const operation = `content.${kind}.${state}`;
    const scope = idempotencyScope(operation, context.actor.auth.userAccountId);
    const hash = idempotencyRequestHash({
      operation,
      actorUserAccountId: context.actor.auth.userAccountId,
      resourceId: contentId,
      expectedVersion,
      payload: { state, reason: normalizedChangeReason },
    });
    return this.db.transaction().execute(async (transaction) => {
      const claim = await this.claimIdempotency(transaction, scope, context.idempotencyKey, hash);
      if (claim.state === "replayed") {
        return {
          value: replayValue<T>(claim, responseSchema, 200, contentId),
          replayed: true,
        };
      }
      const current = await transaction
        .selectFrom(table)
        .selectAll()
        .where("id", "=", contentId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new AppError(404, "content_not_found", "Материал не найден");
      if (current.archived_at || current.publication_state === "archived") {
        throw new AppError(409, "content_archived", "Материал уже архивирован");
      }
      if (current.publication_state === state) {
        throw new AppError(
          409,
          state === "published" ? "content_already_published" : "content_already_archived",
          state === "published" ? "Материал уже опубликован" : "Материал уже архивирован",
        );
      }
      if (Number(current.version) !== expectedVersion) {
        throw new AppError(409, "version_conflict", "Материал был изменён", {
          details: { expectedVersion, currentVersion: Number(current.version) },
        });
      }
      if (state === "draft")
        throw new AppError(422, "invalid_content_state", "Черновик задаётся только при создании");
      const now = new Date();
      const version = expectedVersion + 1;
      const updated = (await transaction
        .updateTable(table)
        .set({
          publication_state: state,
          version,
          published_at: state === "published" ? now : current.published_at,
          archived_at: state === "archived" ? now : current.archived_at,
          updated_by: context.actor.auth.userAccountId,
          updated_at: now,
        })
        .where("id", "=", contentId)
        .where("version", "=", expectedVersion)
        .returning(CONTENT_ROW_COLUMNS)
        .executeTakeFirst()) as StoredContentRow | undefined;
      if (!updated) throw new Error("Could not update public content state");
      await this.recordChange(
        transaction,
        kind,
        contentId,
        version,
        current.document,
        state,
        context,
        normalizedChangeReason,
        state,
        now,
      );
      const value = mapper(updated);
      await this.completeIdempotency(transaction, scope, context.idempotencyKey, hash, contentId, 200, value);
      return { value, replayed: false };
    });
  }

  private async recordChange(
    transaction: ContentTransaction,
    kind: ContentKind,
    contentId: string,
    version: number,
    document: unknown,
    state: ContentState,
    context: ContentMutationContext,
    reason: string,
    action: string,
    occurredAt: Date,
  ): Promise<void> {
    await transaction
      .insertInto("content.revision")
      .values({
        id: newUuid(),
        entity_type: kind,
        entity_id: contentId,
        version,
        document,
        publication_state: state,
        actor_user_account_id: context.actor.auth.userAccountId,
        reason,
        created_at: occurredAt,
      })
      .execute();
    await appendAuditEvent(transaction, {
      eventType: `content.${kind}.${action}`,
      actorType: "user_account",
      actorId: context.actor.auth.userAccountId,
      subjectType: `content_${kind}`,
      subjectId: contentId,
      requestId: context.actor.requestId,
      reason,
      afterState: { publicationState: state, version, documentSha256: requestHash(document) },
      policyVersion: "public-content@1",
      scopeSnapshot: {
        visibility: "all",
        businessRole: context.actor.auth.businessRole,
        roleCodes: context.actor.auth.roles,
      },
      occurredAt,
    });
    await transaction
      .insertInto("platform.outbox_event")
      .values({
        id: newUuid(),
        topic: `content.${kind}.${action}.v1`,
        aggregate_type: `content_${kind}`,
        aggregate_id: contentId,
        payload: { contentId, version, publicationState: state },
        idempotency_key: `content.${kind}.${action}:${contentId}:${version}`,
        occurred_at: occurredAt,
        available_at: occurredAt,
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        delivered_at: null,
        last_error_code: null,
      })
      .execute();
  }

  private async claimIdempotency(
    transaction: ContentTransaction,
    scope: string,
    idempotencyKey: string,
    hash: string,
  ): Promise<IdempotencyClaim> {
    const now = new Date();
    const inserted = await transaction
      .insertInto("platform.idempotency_record")
      .values({
        scope,
        idempotency_key: idempotencyKey,
        request_hash: hash,
        response_status: null,
        response_body: null,
        resource_id: null,
        state: "processing",
        locked_until: new Date(now.getTime() + 30_000),
        expires_at: new Date(now.getTime() + this.options.idempotencyTtlSeconds * 1_000),
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.columns(["scope", "idempotency_key"]).doNothing())
      .returning("idempotency_key")
      .executeTakeFirst();
    if (inserted) return { state: "claimed" };
    const existing = await transaction
      .selectFrom("platform.idempotency_record")
      .select(["request_hash", "state", "resource_id", "response_status", "response_body", "expires_at"])
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== hash)
      throw new AppError(409, "idempotency_conflict", "Idempotency-Key уже использован");
    if (new Date(existing.expires_at) <= now)
      throw new AppError(409, "idempotency_expired", "Idempotency-Key истёк");
    if (
      existing.state !== "completed" ||
      !existing.resource_id ||
      existing.response_status === null ||
      existing.response_body === null
    )
      throw new AppError(409, "idempotency_in_progress", "Операция уже выполняется");
    return {
      state: "replayed",
      resourceId: existing.resource_id,
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    };
  }

  private async completeIdempotency(
    transaction: ContentTransaction,
    scope: string,
    idempotencyKey: string,
    hash: string,
    resourceId: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    const updated = await transaction
      .updateTable("platform.idempotency_record")
      .set({
        state: "completed",
        response_status: responseStatus,
        response_body: responseBody,
        resource_id: resourceId,
        locked_until: null,
        updated_at: new Date(),
      })
      .where("scope", "=", scope)
      .where("idempotency_key", "=", idempotencyKey)
      .where("request_hash", "=", hash)
      .where("state", "=", "processing")
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1)
      throw new Error("Could not complete content idempotency record");
  }
}
