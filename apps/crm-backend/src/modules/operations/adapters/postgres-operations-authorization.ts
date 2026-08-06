import type { Kysely } from "kysely";
import { AppError } from "../../../common/errors.js";
import type { Database } from "../../../db/types.js";
import type { OperationsAccessScope, OperationsActorContext, OperationsAuthorizationPort } from "../ports.js";
import type { OperationsOperationDefinition } from "../registry.js";

export interface GrantedOperationsScope {
  readonly scopeType: string;
  readonly scopeId: string | null;
}

function uniqueIds(grants: readonly GrantedOperationsScope[], scopeType: string): string[] {
  return [
    ...new Set(
      grants
        .filter((grant) => grant.scopeType === scopeType)
        .map((grant) => grant.scopeId)
        .filter((scopeId): scopeId is string => scopeId !== null),
    ),
  ];
}

/**
 * Converts persisted grants to a closed, domain-specific row scope. Unknown
 * scope types are ignored and therefore deny access instead of widening it.
 */
export function resolveOperationsAccessScope(
  actor: OperationsActorContext,
  operation: OperationsOperationDefinition,
  grants: readonly GrantedOperationsScope[],
): OperationsAccessScope {
  if (grants.some((grant) => grant.scopeType === "all")) {
    return Object.freeze({
      visibility: "all",
      actorUserAccountId: actor.userAccountId,
      resourceIds: Object.freeze([]),
      includeActorEvents: true,
    });
  }

  if (operation.scopeKind === "platform_metrics") {
    throw new AppError(403, "permission_scope_denied", "Метрики требуют полный platform scope");
  }

  const assignedIds = uniqueIds(grants, "assigned");
  if (operation.scopeKind === "migration_run") {
    if (assignedIds.length === 0) {
      throw new AppError(403, "permission_scope_denied", "Нет назначенных запусков миграции");
    }
    return Object.freeze({
      visibility: "restricted",
      actorUserAccountId: actor.userAccountId,
      resourceIds: Object.freeze(assignedIds),
      includeActorEvents: false,
    });
  }

  const includeActorEvents = grants.some((grant) => grant.scopeType === "self");
  if (assignedIds.length > 0) {
    return Object.freeze({
      visibility: "restricted",
      actorUserAccountId: actor.userAccountId,
      resourceIds: Object.freeze(assignedIds),
      includeActorEvents,
    });
  }
  if (includeActorEvents) {
    return Object.freeze({
      visibility: "self",
      actorUserAccountId: actor.userAccountId,
      resourceIds: Object.freeze([]),
      includeActorEvents: true,
    });
  }

  throw new AppError(403, "permission_scope_denied", "Область доступа не поддерживает эту операцию");
}

export class PostgresOperationsAuthorizationAdapter implements OperationsAuthorizationPort {
  constructor(private readonly db: Kysely<Database>) {}

  async authorize(
    actor: OperationsActorContext,
    operation: OperationsOperationDefinition,
  ): Promise<OperationsAccessScope> {
    const now = new Date();
    const grants = await this.db
      .selectFrom("identity.user_role_assignment as assignment")
      .innerJoin("identity.user_account as account", "account.id", "assignment.user_account_id")
      .innerJoin(
        "identity.role_permission as role_permission",
        "role_permission.role_code",
        "assignment.role_code",
      )
      .select(["assignment.scope_type", "assignment.scope_id"])
      .where("assignment.user_account_id", "=", actor.userAccountId)
      .where("role_permission.permission_code", "=", operation.permissionCode)
      .where("account.account_state", "=", "active")
      .where("account.risk_state", "=", "normal")
      .where("account.archived_at", "is", null)
      .where("assignment.archived_at", "is", null)
      .where("assignment.valid_from", "<=", now)
      .where((expression) =>
        expression.or([
          expression("assignment.valid_to", "is", null),
          expression("assignment.valid_to", ">", now),
        ]),
      )
      .execute();

    if (grants.length === 0) {
      throw new AppError(403, "permission_denied", "Недостаточно прав для операции");
    }

    return resolveOperationsAccessScope(
      actor,
      operation,
      grants.map((grant) => ({ scopeType: grant.scope_type, scopeId: grant.scope_id })),
    );
  }
}
