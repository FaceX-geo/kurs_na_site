import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import type { Database } from "../src/db/types.js";
import {
  type AuthContext,
  adminSessionCursorSigningKey,
  IdentityService,
  ownSessionCursorSigningKey,
} from "../src/modules/identity/service.js";

const config = loadConfig({
  NODE_ENV: "test",
  CURSOR_SIGNING_KEY: "session-pagination-signing-key-at-least-32-chars",
  SESSION_TOKEN_PEPPER: "session-pagination-pepper-at-least-32-chars",
});

const context: AuthContext = {
  sessionId: "019fd7d0-6789-7000-8000-000000000001",
  userAccountId: "019fd7d0-6789-7000-8000-000000000002",
  personId: "019fd7d0-6789-7000-8000-000000000003",
  email: "user@example.test",
  authenticationLevel: "mfa",
  csrfTokenHash: "a".repeat(64),
  roles: [],
  permissions: [],
};

function sessionRow(id: string, createdAt: string) {
  return {
    id,
    authentication_level: "mfa",
    created_at: new Date(createdAt),
    last_seen_at: new Date(createdAt),
    absolute_expires_at: new Date("2026-08-07T00:00:00.000Z"),
    revoked_at: null,
  };
}

function createSessionListDatabase(initialRows: ReturnType<typeof sessionRow>[]) {
  let rows = initialRows;
  const orderByCalls: Array<[string, string]> = [];
  const limits: number[] = [];
  let whereCalls = 0;

  const database = {
    selectFrom(table: string) {
      if (table !== "identity.session") {
        throw new Error(`Unexpected table ${table}`);
      }
      const query = {
        select() {
          return query;
        },
        where() {
          whereCalls += 1;
          return query;
        },
        orderBy(column: string, direction: string) {
          orderByCalls.push([column, direction]);
          return query;
        },
        limit(value: number) {
          limits.push(value);
          return query;
        },
        async execute() {
          return rows;
        },
      };
      return query;
    },
  } as unknown as Kysely<Database>;

  return {
    database,
    orderByCalls,
    limits,
    getWhereCalls: () => whereCalls,
    replaceRows(next: ReturnType<typeof sessionRow>[]) {
      rows = next;
    },
  };
}

describe("identity session cursor pagination", () => {
  it("uses a stable keyset order, limit+1 and an actor-bound signed cursor", async () => {
    const fixture = createSessionListDatabase([
      sessionRow("019fd7d0-6789-7000-8000-000000000010", "2026-08-06T12:00:00.000Z"),
      sessionRow("019fd7d0-6789-7000-8000-000000000009", "2026-08-06T11:00:00.000Z"),
      sessionRow("019fd7d0-6789-7000-8000-000000000008", "2026-08-06T10:00:00.000Z"),
    ]);
    const service = new IdentityService(fixture.database, config);

    const first = await service.listSessions(context, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    expect(first.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
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
    await service.listSessions(context, { limit: 2, cursor: nextCursor });
    expect(fixture.getWhereCalls()).toBe(3);

    await expect(
      service.listSessions(
        { ...context, userAccountId: "019fd7d0-6789-7000-8000-000000000099" },
        { limit: 2, cursor: nextCursor },
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_cursor" });
  });

  it("separates own and admin cursor scopes and ships the matching composite index", async () => {
    const ownKey = ownSessionCursorSigningKey(config.cursorSigningKey, context.userAccountId);
    const adminKey = adminSessionCursorSigningKey(
      config.cursorSigningKey,
      context.userAccountId,
      "019fd7d0-6789-7000-8000-000000000077",
    );
    expect(ownKey).not.toBe(adminKey);
    expect(adminKey).not.toBe(
      adminSessionCursorSigningKey(
        config.cursorSigningKey,
        context.userAccountId,
        "019fd7d0-6789-7000-8000-000000000078",
      ),
    );

    const migration = await readFile(
      path.resolve("db/migrations/0120_identity_session_pagination.up.sql"),
      "utf8",
    );
    expect(migration).toContain("user_account_id, created_at DESC, id DESC");
  });
});
