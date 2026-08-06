import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import { IdentityAdminService } from "../src/modules/identity/admin-service.js";
import type { AuthContext, IdentityService } from "../src/modules/identity/service.js";

vi.mock("../src/modules/platform/audit.js", () => ({
  appendAuditEvent: vi.fn(async () => "019fd7d0-6789-7000-8000-000000000090"),
}));

const config = loadConfig({
  NODE_ENV: "test",
  CURSOR_SIGNING_KEY: "admin-session-pagination-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "admin-session-pagination-pepper-at-least-32-chars",
});

const context: AuthContext = {
  sessionId: "019fd7d0-6789-7000-8000-000000000001",
  userAccountId: "019fd7d0-6789-7000-8000-000000000002",
  personId: "019fd7d0-6789-7000-8000-000000000003",
  email: "admin@example.test",
  authenticationLevel: "mfa",
  csrfTokenHash: "a".repeat(64),
  roles: ["platform_superadmin"],
  permissions: ["identity.sessions.read_all"],
};

function sessionRow(id: string, createdAt: string) {
  return {
    id,
    authentication_level: "fresh_mfa",
    ip_prefix: "192.0.2.0/24",
    created_at: new Date(createdAt),
    last_seen_at: new Date(createdAt),
    absolute_expires_at: new Date("2026-08-07T00:00:00.000Z"),
    revoked_at: null,
  };
}

function createAdminSessionDatabase(initialRows: ReturnType<typeof sessionRow>[]) {
  let rows = initialRows;
  const orderByCalls: Array<[string, string]> = [];
  const limits: number[] = [];
  let sessionWhereCalls = 0;

  const transaction = {
    selectFrom(table: string) {
      if (table === "identity.user_account") {
        const accountQuery = {
          select() {
            return accountQuery;
          },
          where() {
            return accountQuery;
          },
          async executeTakeFirst() {
            return { id: "019fd7d0-6789-7000-8000-000000000077" };
          },
        };
        return accountQuery;
      }
      if (table !== "identity.session") {
        throw new Error(`Unexpected table ${table}`);
      }
      const sessionQuery = {
        select() {
          return sessionQuery;
        },
        where() {
          sessionWhereCalls += 1;
          return sessionQuery;
        },
        orderBy(column: string, direction: string) {
          orderByCalls.push([column, direction]);
          return sessionQuery;
        },
        limit(value: number) {
          limits.push(value);
          return sessionQuery;
        },
        async execute() {
          return rows;
        },
      };
      return sessionQuery;
    },
  };

  const database = {
    transaction() {
      return {
        execute<T>(callback: (value: typeof transaction) => Promise<T>): Promise<T> {
          return callback(transaction);
        },
      };
    },
  } as unknown as Kysely<Database>;

  return {
    database,
    orderByCalls,
    limits,
    getSessionWhereCalls: () => sessionWhereCalls,
    replaceRows(next: ReturnType<typeof sessionRow>[]) {
      rows = next;
    },
  };
}

describe("admin identity session cursor pagination", () => {
  it("binds the cursor to actor and subject while preserving the stable keyset order", async () => {
    const subjectId = "019fd7d0-6789-7000-8000-000000000077";
    const fixture = createAdminSessionDatabase([
      sessionRow("019fd7d0-6789-7000-8000-000000000013", "2026-08-06T13:00:00.000Z"),
      sessionRow("019fd7d0-6789-7000-8000-000000000012", "2026-08-06T12:00:00.000Z"),
      sessionRow("019fd7d0-6789-7000-8000-000000000011", "2026-08-06T11:00:00.000Z"),
    ]);
    const service = new IdentityAdminService(fixture.database, config, {} as IdentityService);

    const first = await service.listUserSessions(
      context,
      subjectId,
      { reason: "Проверка активных сессий", limit: 2 },
      { requestId: "request-1" },
    );
    expect(first.items).toHaveLength(2);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    const nextCursor = first.page.nextCursor;
    if (!nextCursor) {
      throw new Error("Expected a signed next cursor");
    }
    expect(fixture.orderByCalls).toEqual([
      ["created_at", "desc"],
      ["id", "desc"],
    ]);
    expect(fixture.limits).toEqual([3]);

    fixture.replaceRows([]);
    await service.listUserSessions(
      context,
      subjectId,
      { reason: "Следующая страница", limit: 2, cursor: nextCursor },
      { requestId: "request-2" },
    );
    expect(fixture.getSessionWhereCalls()).toBe(3);

    await expect(
      service.listUserSessions(
        context,
        "019fd7d0-6789-7000-8000-000000000078",
        { reason: "Чужой курсор", limit: 2, cursor: nextCursor },
        { requestId: "request-3" },
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_cursor" });
  });
});
