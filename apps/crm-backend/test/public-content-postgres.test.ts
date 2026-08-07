import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/types.js";
import type { AuthContext } from "../src/modules/identity/service.js";
import type { StoryContentInput } from "../src/modules/public-content/contracts.js";
import { PostgresPublicContentRepository } from "../src/modules/public-content/index.js";
import type { ContentActor } from "../src/modules/public-content/ports.js";

const databaseUrl = process.env.PUBLIC_CONTENT_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const firstPersonId = "71000000-0000-4000-8000-000000000001";
const firstUserId = "71000000-0000-4000-8000-000000000002";
const secondPersonId = "72000000-0000-4000-8000-000000000001";
const secondUserId = "72000000-0000-4000-8000-000000000002";

let pool: Pool | undefined;
let db: Kysely<Database> | undefined;

function actor(userAccountId: string): ContentActor {
  const auth: AuthContext = {
    sessionId: `${userAccountId.slice(0, -1)}3`,
    userAccountId,
    personId: userAccountId === firstUserId ? firstPersonId : secondPersonId,
    email: userAccountId === firstUserId ? "content-admin-1@example.test" : "content-admin-2@example.test",
    authenticationLevel: "mfa",
    csrfTokenHash: "csrf-hash",
    roles: ["platform_superadmin"],
    permissions: ["content.story.read", "content.story.manage"],
    businessRole: "SUPER_ADMIN",
    employeeProfileId: null,
  };
  return { auth, requestId: `request-${userAccountId}` };
}

function story(publicId: string, title: string): StoryContentInput {
  return {
    publicId,
    tone: "berry",
    filters: ["Переезд"],
    cardTags: ["Север"],
    ariaLabel: title,
    eyebrow: "История участника",
    title,
    person: "Иван",
    route: "Москва — Мурманск",
    avatar: "assets/images/story.webp",
    avatarAlt: "Участник программы",
    cardQuote: "Переезд состоялся",
    quote: "Специалист помог пройти весь маршрут",
    tags: ["Работа"],
    lead: "Проверенная история переезда",
    gallery: [],
    steps: ["Оставил заявку", "Переехал"],
    reason: "Интеграционный тест реестра",
  };
}

integration("Postgres public content repository", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    const now = new Date();
    await db
      .insertInto("identity.person")
      .values([
        {
          id: firstPersonId,
          surname: "Админов",
          given_name: "Первый",
          middle_name: null,
          birth_date: null,
          normalized_email: "content-admin-1@example.test",
          normalized_phone: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        },
        {
          id: secondPersonId,
          surname: "Админов",
          given_name: "Второй",
          middle_name: null,
          birth_date: null,
          normalized_email: "content-admin-2@example.test",
          normalized_phone: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();
    await db
      .insertInto("identity.user_account")
      .values([
        {
          id: firstUserId,
          person_id: firstPersonId,
          email: "content-admin-1@example.test",
          username: null,
          password_hash: null,
          account_state: "active",
          credential_state: "invited",
          risk_state: "normal",
          mfa_state: "enrollment_required",
          locked_until: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        },
        {
          id: secondUserId,
          person_id: secondPersonId,
          email: "content-admin-2@example.test",
          username: null,
          password_hash: null,
          account_state: "active",
          credential_state: "invited",
          risk_state: "normal",
          mfa_state: "enrollment_required",
          locked_until: null,
          created_at: now,
          updated_at: now,
          archived_at: null,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await db?.destroy();
    db = undefined;
    pool = undefined;
  });

  it("isolates idempotency by actor and rejects a concurrent public-id conflict", async () => {
    if (!db) throw new Error("Test database is not initialized");
    const repository = new PostgresPublicContentRepository(db, {
      cursorSigningKey: "public-content-postgres-cursor-signing-key",
      idempotencyTtlSeconds: 3_600,
    });

    const first = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: "shared-create-key" },
      story("story-actor-one", "История первого администратора"),
    );
    const second = await repository.createStory(
      { actor: actor(secondUserId), idempotencyKey: "shared-create-key" },
      story("story-actor-two", "История второго администратора"),
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    await expect(
      repository.createStory(
        { actor: actor(secondUserId), idempotencyKey: "duplicate-public-id-key" },
        story("story-actor-one", "Конфликт публичного идентификатора"),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "content_public_id_conflict" });
  });

  it("stores one authoritative response for concurrent and lost-response retries", async () => {
    if (!db) throw new Error("Test database is not initialized");
    const repository = new PostgresPublicContentRepository(db, {
      cursorSigningKey: "public-content-postgres-cursor-signing-key",
      idempotencyTtlSeconds: 3_600,
    });
    const suffix = randomUUID();
    const publicId = `story-replay-${suffix}`;
    const idempotencyKey = `create-replay-${suffix}`;
    const input = story(publicId, "Авторитетный снимок ответа");

    const concurrent = await Promise.all([
      repository.createStory({ actor: actor(firstUserId), idempotencyKey }, input),
      repository.createStory({ actor: actor(firstUserId), idempotencyKey }, input),
    ]);
    const created = concurrent.find((result) => !result.replayed);
    const concurrentReplay = concurrent.find((result) => result.replayed);
    expect(created).toBeDefined();
    expect(concurrentReplay).toBeDefined();
    expect(concurrentReplay?.value).toEqual(created?.value);

    if (!created) throw new Error("Expected one created result");
    const changed = await repository.updateStory(
      {
        actor: actor(firstUserId),
        idempotencyKey: `update-after-lost-response-${suffix}`,
        expectedVersion: 1,
      },
      created.value.id,
      { ...input, title: "Материал изменён после потерянного ответа" },
    );
    expect(changed.value.version).toBe(2);

    const lostResponseReplay = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey },
      input,
    );
    expect(lostResponseReplay).toEqual({ value: created.value, replayed: true });
    expect(lostResponseReplay.value.version).toBe(1);
    expect(lostResponseReplay.value.title).toBe("Авторитетный снимок ответа");

    await expect(
      repository.createStory(
        { actor: actor(firstUserId), idempotencyKey },
        { ...input, title: "Тот же ключ с другим payload" },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });

    const [storyRows, createdRevisions, createdOutbox] = await Promise.all([
      db
        .selectFrom("content.story")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("public_id", "=", publicId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("content.revision")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("entity_type", "=", "story")
        .where("entity_id", "=", created.value.id)
        .where("version", "=", 1)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("platform.outbox_event")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("topic", "=", "content.story.created.v1")
        .where("aggregate_id", "=", created.value.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(Number(storyRows.count)).toBe(1);
    expect(Number(createdRevisions.count)).toBe(1);
    expect(Number(createdOutbox.count)).toBe(1);
  });

  it("replays the original publish receipt and rejects publishing an already-published row", async () => {
    if (!db) throw new Error("Test database is not initialized");
    const repository = new PostgresPublicContentRepository(db, {
      cursorSigningKey: "public-content-postgres-cursor-signing-key",
      idempotencyTtlSeconds: 3_600,
    });
    const suffix = randomUUID();
    const input = story(`story-publish-once-${suffix}`, "Публикация только один раз");
    const created = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: `publish-once-create-${suffix}` },
      input,
    );
    const publishContext = {
      actor: actor(firstUserId),
      idempotencyKey: `publish-once-state-${suffix}`,
      expectedVersion: 1,
    } as const;
    const published = await repository.setStoryState(
      publishContext,
      created.value.id,
      "published",
      "Публикация проверенной истории",
    );
    expect(published.replayed).toBe(false);
    expect(published.value).toMatchObject({ state: "published", version: 2 });

    const changed = await repository.updateStory(
      {
        actor: actor(firstUserId),
        idempotencyKey: `publish-once-update-${suffix}`,
        expectedVersion: 2,
      },
      created.value.id,
      { ...input, title: "Опубликованный материал изменён позднее" },
    );
    expect(changed.value).toMatchObject({ state: "published", version: 3 });

    const replay = await repository.setStoryState(
      publishContext,
      created.value.id,
      "published",
      "Публикация проверенной истории",
    );
    expect(replay).toEqual({ value: published.value, replayed: true });
    expect(replay.value.title).toBe("Публикация только один раз");

    await expect(
      repository.setStoryState(
        {
          actor: actor(firstUserId),
          idempotencyKey: `publish-twice-state-${suffix}`,
          expectedVersion: 3,
        },
        created.value.id,
        "published",
        "Повторная публикация новым запросом",
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "content_already_published" });

    const [publishRevisions, publishOutbox, publishAudit] = await Promise.all([
      db
        .selectFrom("content.revision")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("entity_type", "=", "story")
        .where("entity_id", "=", created.value.id)
        .where("publication_state", "=", "published")
        .where("version", "=", 2)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("platform.outbox_event")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("topic", "=", "content.story.published.v1")
        .where("aggregate_id", "=", created.value.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("platform.audit_event")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("event_type", "=", "content.story.published")
        .where("subject_id", "=", created.value.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(Number(publishRevisions.count)).toBe(1);
    expect(Number(publishOutbox.count)).toBe(1);
    expect(Number(publishAudit.count)).toBe(1);
  });

  it("paginates all managed rows while separating published items and fallback suppressions", async () => {
    if (!db) throw new Error("Test database is not initialized");
    const repository = new PostgresPublicContentRepository(db, {
      cursorSigningKey: "public-content-postgres-cursor-signing-key",
      idempotencyTtlSeconds: 3_600,
    });
    const draft = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: "draft-create-key" },
      story("story-fallback-draft", "Черновик вместо fallback"),
    );
    const published = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: "published-create-key" },
      story("story-fallback-published", "Опубликованная история"),
    );
    await repository.setStoryState(
      { actor: actor(firstUserId), idempotencyKey: "published-state-key", expectedVersion: 1 },
      published.value.id,
      "published",
      "Публикация проверенной истории",
    );
    const archived = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: "archived-create-key" },
      story("story-fallback-archived", "Архив вместо fallback"),
    );
    await repository.setStoryState(
      { actor: actor(firstUserId), idempotencyKey: "archived-state-key", expectedVersion: 1 },
      archived.value.id,
      "archived",
      "Архивация тестовой истории",
    );

    const itemIds: string[] = [];
    const suppressedIds: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await repository.listPublicStories({ limit: 2, ...(cursor ? { cursor } : {}) });
      itemIds.push(...page.items.map((item) => item.id));
      suppressedIds.push(...page.suppressedIds);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);

    expect(itemIds).toContain("story-fallback-published");
    expect(itemIds).not.toContain(draft.value.publicId);
    expect(suppressedIds).toEqual(
      expect.arrayContaining(["story-fallback-draft", "story-fallback-archived"]),
    );

    const firstPage = await repository.listPublicStories({ limit: 2 });
    expect(firstPage.page.nextCursor).not.toBeNull();
    const publicCursor = firstPage.page.nextCursor;
    if (!publicCursor) throw new Error("Expected a public cursor for the cross-view check");
    await expect(repository.listStories({ limit: 2, cursor: publicCursor })).rejects.toMatchObject({
      statusCode: 422,
      code: "invalid_cursor",
    });
  });

  it("enforces normalized media paths, automatic versioning and immutable revisions", async () => {
    if (!db) throw new Error("Test database is not initialized");
    const repository = new PostgresPublicContentRepository(db, {
      cursorSigningKey: "public-content-postgres-cursor-signing-key",
      idempotencyTtlSeconds: 3_600,
    });
    await expect(
      repository.createStory(
        { actor: actor(firstUserId), idempotencyKey: "unsafe-asset-key" },
        { ...story("story-unsafe-asset", "Небезопасный путь"), avatar: "assets/../private.txt" },
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_story_asset" });

    const created = await repository.createStory(
      { actor: actor(firstUserId), idempotencyKey: "trigger-create-key" },
      story("story-trigger-check", "Проверка триггеров"),
    );
    await db
      .updateTable("content.story")
      .set({ updated_by: secondUserId })
      .where("id", "=", created.value.id)
      .executeTakeFirst();
    const versioned = await db
      .selectFrom("content.story")
      .select("version")
      .where("id", "=", created.value.id)
      .executeTakeFirstOrThrow();
    expect(Number(versioned.version)).toBe(2);

    await expect(
      db
        .updateTable("content.revision")
        .set({ reason: "Попытка изменить историю ревизий" })
        .where("entity_id", "=", created.value.id)
        .execute(),
    ).rejects.toMatchObject({ code: "23000" });

    const invalidRevisionInput = story("story-trigger-check", "Проверка триггеров");
    const { publicId: _publicId, reason: _reason, ...invalidRevisionDocument } = invalidRevisionInput;
    await expect(
      db
        .insertInto("content.revision")
        .values({
          id: "73000000-0000-4000-8000-000000000001",
          entity_type: "story",
          entity_id: created.value.id,
          version: 99,
          document: invalidRevisionDocument,
          publication_state: "published",
          actor_user_account_id: firstUserId,
          reason: "Несогласованная ревизия должна быть отвергнута",
          created_at: new Date(),
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23000" });
  });
});
