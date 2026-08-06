import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors.js";
import { resolveOperationsAccessScope } from "../src/modules/operations/adapters/postgres-operations-authorization.js";
import type { OperationsActorContext } from "../src/modules/operations/ports.js";
import { OPERATIONS } from "../src/modules/operations/registry.js";

const actor: OperationsActorContext = {
  userAccountId: "11111111-1111-4111-8111-111111111111",
  requestId: "request-test",
};

describe("operations access scopes", () => {
  it("keeps assigned migration runs as an explicit row scope", () => {
    const scope = resolveOperationsAccessScope(actor, OPERATIONS["migration.runs.list"], [
      { scopeType: "assigned", scopeId: "22222222-2222-4222-8222-222222222222" },
      { scopeType: "assigned", scopeId: "22222222-2222-4222-8222-222222222222" },
    ]);

    expect(scope).toEqual({
      visibility: "restricted",
      actorUserAccountId: actor.userAccountId,
      resourceIds: ["22222222-2222-4222-8222-222222222222"],
      includeActorEvents: false,
    });
  });

  it("supports self audit without granting global audit access", () => {
    const scope = resolveOperationsAccessScope(actor, OPERATIONS["audit.events.list"], [
      { scopeType: "self", scopeId: null },
    ]);

    expect(scope.visibility).toBe("self");
    expect(scope.includeActorEvents).toBe(true);
    expect(scope.resourceIds).toEqual([]);
  });

  it("does not reinterpret unknown scope types as all", () => {
    expect(() =>
      resolveOperationsAccessScope(actor, OPERATIONS["migration.conflicts.list"], [
        { scopeType: "department", scopeId: "33333333-3333-4333-8333-333333333333" },
      ]),
    ).toThrowError(AppError);
  });

  it("requires all scope for aggregate platform metrics", () => {
    expect(() =>
      resolveOperationsAccessScope(actor, OPERATIONS["metrics.read"], [{ scopeType: "self", scopeId: null }]),
    ).toThrowError(/full platform scope|полный platform scope/i);

    expect(
      resolveOperationsAccessScope(actor, OPERATIONS["metrics.read"], [{ scopeType: "all", scopeId: null }])
        .visibility,
    ).toBe("all");
  });
});
