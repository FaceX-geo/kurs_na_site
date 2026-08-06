import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/common/errors.js";
import type { AuthContext } from "../src/modules/identity/service.js";
import type { AdminStory } from "../src/modules/public-content/contracts.js";
import {
  parsePublicContentIfMatchVersion,
  publicContentPlugin,
} from "../src/modules/public-content/plugin.js";
import {
  PUBLIC_CONTENT_OPERATION_LIST,
  PUBLIC_CONTENT_OPERATIONS,
  PUBLIC_STORY_READ_OPERATION_LIST,
} from "../src/modules/public-content/registry.js";
import type { PublicContentService } from "../src/modules/public-content/service.js";

const apps: Fastify.FastifyInstance[] = [];

const auth: AuthContext = {
  sessionId: "10000000-0000-4000-8000-000000000001",
  userAccountId: "10000000-0000-4000-8000-000000000002",
  personId: "10000000-0000-4000-8000-000000000003",
  email: "admin@example.test",
  authenticationLevel: "mfa",
  csrfTokenHash: "csrf-hash",
  roles: ["platform_superadmin"],
  permissions: [
    "content.vacancy.read",
    "content.vacancy.manage",
    "content.story.read",
    "content.story.manage",
  ],
  businessRole: "SUPER_ADMIN",
  employeeProfileId: null,
};

const adminStory: AdminStory = {
  id: "30000000-0000-4000-8000-000000000001",
  publicId: "story-legacy-1",
  tone: "berry",
  filters: ["Переезд"],
  cardTags: ["Север"],
  ariaLabel: "История переезда",
  eyebrow: "Новая история",
  title: "Переезд в Мурманск",
  person: "Иван",
  route: "Москва — Мурманск",
  avatar: "assets/images/story.webp",
  avatarAlt: "Иван в Мурманске",
  cardQuote: "Нашёл работу",
  quote: "Переезд прошёл успешно",
  tags: ["Работа"],
  lead: "Поддержка специалиста помогла переехать",
  gallery: [],
  steps: ["Оставил заявку"],
  state: "archived",
  version: 3,
  publishedAt: "2026-08-06T10:00:00.000Z",
  createdAt: "2026-08-06T09:00:00.000Z",
  updatedAt: "2026-08-06T11:00:00.000Z",
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appFixture(service: Partial<PublicContentService>) {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerErrorHandling(app);
  await app.register(swagger, {
    openapi: {
      info: { title: "Public content contract", version: "1.0.0" },
      components: {
        securitySchemes: {
          sessionCookie: { type: "apiKey", in: "cookie", name: "crm_session" },
          csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        },
      },
    },
  });
  await app.register(publicContentPlugin, {
    service: service as PublicContentService,
    resolveAuth: async () => auth,
    verifyMutationRequest: async () => undefined,
  });
  await app.ready();
  return app;
}

describe("public content OpenAPI", () => {
  it("publishes every versioned admin and public registry operation", async () => {
    const app = await appFixture({});
    const document = app.swagger() as {
      paths?: Record<
        string,
        Record<
          string,
          {
            operationId?: string;
            deprecated?: boolean;
            security?: Array<Record<string, string[]>>;
            "x-permission-code"?: string;
            parameters?: Array<{ in?: string; name?: string }>;
            responses?: Record<string, { headers?: Record<string, unknown> }>;
          }
        >
      >;
    };

    for (const operation of PUBLIC_CONTENT_OPERATION_LIST) {
      const path = operation.path.replace(/:([^/]+)/gu, "{$1}");
      const route = document.paths?.[path]?.[operation.method.toLowerCase()];
      expect(route, `${operation.method} ${path}`).toBeDefined();
      expect(route?.operationId).toBe(operation.operationId);
      expect(route?.["x-permission-code"]).toBe(operation.permissionCode);
    }
    expect(PUBLIC_CONTENT_OPERATION_LIST).toHaveLength(Object.keys(PUBLIC_CONTENT_OPERATIONS).length);

    for (const operation of PUBLIC_STORY_READ_OPERATION_LIST) {
      const route = document.paths?.[operation.path]?.get;
      expect(route?.operationId).toBe(operation.operationId);
      expect(route?.deprecated).toBe(operation.deprecated ? true : undefined);
      expect(route?.security).toEqual([]);
      expect(route?.parameters?.map((parameter) => parameter.name)).not.toContain("state");
      expect(JSON.stringify(route?.responses?.["200"])).toContain("suppressedIds");
    }

    const archive = document.paths?.["/internal/v1/admin/content/stories/{contentId}/archive"]?.post;
    expect(archive?.responses?.["200"]?.headers).toMatchObject({
      ETag: expect.any(Object),
      "Idempotency-Replayed": expect.any(Object),
    });
  });

  it("returns only published items plus paginated fallback suppressions on the public route", async () => {
    const listPublicStories = vi.fn(async () => ({
      items: [],
      suppressedIds: ["story-legacy-1"],
      page: { limit: 25, hasMore: true, nextCursor: "signed-next-cursor" },
    }));
    const app = await appFixture({ listPublicStories });

    const response = await app.inject({ method: "GET", url: "/public/v1/stories?limit=25" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      suppressedIds: ["story-legacy-1"],
      page: { limit: 25, hasMore: true, nextCursor: "signed-next-cursor" },
    });
    expect(listPublicStories).toHaveBeenCalledWith({ limit: 25 });
  });

  it("returns semantic If-Match errors and mutation response headers", async () => {
    const archiveStory = vi.fn(async () => ({ value: adminStory, replayed: true }));
    const app = await appFixture({ archiveStory });
    const baseRequest = {
      method: "POST" as const,
      url: `/internal/v1/admin/content/stories/${adminStory.id}/archive`,
      headers: {
        "idempotency-key": "archive-key-0001",
        "x-csrf-token": "csrf-token-for-contract-test",
      },
      payload: { reason: "История скрыта редактором" },
    };

    const missing = await app.inject(baseRequest);
    expect(missing.statusCode).toBe(428);
    expect(missing.json()).toMatchObject({ code: "precondition_required" });
    expect(archiveStory).not.toHaveBeenCalled();

    const invalid = await app.inject({
      ...baseRequest,
      headers: { ...baseRequest.headers, "if-match": 'W/"v2"' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ code: "invalid_if_match" });
    expect(archiveStory).not.toHaveBeenCalled();

    const success = await app.inject({
      ...baseRequest,
      headers: { ...baseRequest.headers, "if-match": '"v2"' },
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers.etag).toBe('"v3"');
    expect(success.headers["idempotency-replayed"]).toBe("true");
    expect(archiveStory).toHaveBeenCalledWith(
      expect.objectContaining({ auth, requestId: expect.any(String) }),
      adminStory.id,
      2,
      "archive-key-0001",
      "История скрыта редактором",
    );
  });
});

describe("public content If-Match parser", () => {
  it.each(["3", "v3", '"3"', '"v3"'])("accepts %s", (value) => {
    expect(parsePublicContentIfMatchVersion(value)).toBe(3);
  });

  it.each([undefined, "0", 'W/"v3"', "3,4", "*"])("rejects %s", (value) => {
    expect(() => parsePublicContentIfMatchVersion(value)).toThrow();
  });
});
