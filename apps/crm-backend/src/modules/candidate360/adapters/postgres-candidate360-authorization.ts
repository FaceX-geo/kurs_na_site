import type { Kysely } from "kysely";
import { AppError } from "../../../common/errors.js";
import type { Database } from "../../../db/types.js";
import type { CrmAccessScope } from "../../crm/ports.js";
import type { Candidate360AuthorizationPort, Candidate360AuthorizationRequest } from "../ports.js";

export interface Candidate360GrantedScope {
  readonly scopeType: string;
  readonly scopeId: string | null;
}

export interface Candidate360TeamScopeResolver {
  resolveEmployeeProfileIds(teamIds: readonly string[]): Promise<readonly string[]>;
}

export interface PostgresCandidate360AuthorizationOptions {
  readonly teamScopeResolver?: Candidate360TeamScopeResolver;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function resolveCandidate360AccessScope(
  grants: readonly Candidate360GrantedScope[],
  actorUserAccountId: string,
  actorEmployeeProfileId: string | null,
  teamScopeResolver?: Candidate360TeamScopeResolver,
): Promise<CrmAccessScope> {
  const allGranted = grants.some((grant) => grant.scopeType === "all");
  const departmentIds = unique(
    grants.filter((grant) => grant.scopeType === "department").map((grant) => grant.scopeId),
  );
  const teamIds = unique(grants.filter((grant) => grant.scopeType === "team").map((grant) => grant.scopeId));
  const assignedGranted = grants.some((grant) => grant.scopeType === "assigned");

  if (!allGranted && departmentIds.length === 0 && teamIds.length === 0 && !assignedGranted) {
    throw new AppError(403, "permission_denied", "Недостаточно прав для операции");
  }

  let teamEmployeeProfileIds: readonly string[] = [];
  if (!allGranted && departmentIds.length === 0 && teamIds.length > 0) {
    if (!teamScopeResolver) {
      throw new AppError(403, "team_scope_unavailable", "Командная область доступа не настроена");
    }
    teamEmployeeProfileIds = unique(await teamScopeResolver.resolveEmployeeProfileIds(teamIds));
    if (teamEmployeeProfileIds.length === 0 && !assignedGranted) {
      throw new AppError(403, "team_scope_empty", "Командная область доступа пуста");
    }
  }

  if (assignedGranted && !actorEmployeeProfileId && !allGranted && departmentIds.length === 0) {
    throw new AppError(
      403,
      "employee_profile_required",
      "Для назначенной области доступа нужен профиль сотрудника",
    );
  }

  const employeeProfileIds = unique([
    ...teamEmployeeProfileIds,
    ...(assignedGranted ? [actorEmployeeProfileId] : []),
  ]);
  const visibility: CrmAccessScope["visibility"] = allGranted
    ? "all"
    : departmentIds.length > 0
      ? "department"
      : teamIds.length > 0
        ? "team"
        : "assigned";

  return Object.freeze({
    visibility,
    actorUserAccountId,
    actorEmployeeProfileId,
    employeeProfileIds: Object.freeze(employeeProfileIds),
    teamIds: Object.freeze(teamIds),
    organizationUnitIds: Object.freeze(departmentIds),
    fieldMask: Object.freeze([]),
  });
}

export class PostgresCandidate360AuthorizationAdapter implements Candidate360AuthorizationPort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: PostgresCandidate360AuthorizationOptions = {},
  ) {}

  async authorize(request: Candidate360AuthorizationRequest): Promise<CrmAccessScope> {
    const now = new Date();
    const [actorProfile, grants] = await Promise.all([
      this.db
        .selectFrom("identity.user_account as account")
        .leftJoin("identity.employee_profile as employee", (join) =>
          join
            .onRef("employee.person_id", "=", "account.person_id")
            .on("employee.archived_at", "is", null)
            .on("employee.employment_state", "=", "active"),
        )
        .select("employee.id as employee_profile_id")
        .where("account.id", "=", request.actor.userAccountId)
        .where("account.archived_at", "is", null)
        .executeTakeFirst(),
      this.db
        .selectFrom("identity.user_role_assignment as assignment")
        .innerJoin(
          "identity.role_permission as role_permission",
          "role_permission.role_code",
          "assignment.role_code",
        )
        .select(["assignment.scope_type", "assignment.scope_id"])
        .where("assignment.user_account_id", "=", request.actor.userAccountId)
        .where("role_permission.permission_code", "=", request.operation.permissionCode)
        .where("assignment.archived_at", "is", null)
        .where("assignment.valid_from", "<=", now)
        .where((expression) =>
          expression.or([
            expression("assignment.valid_to", "is", null),
            expression("assignment.valid_to", ">", now),
          ]),
        )
        .execute(),
    ]);

    if (!actorProfile || grants.length === 0) {
      throw new AppError(403, "permission_denied", "Недостаточно прав для операции");
    }

    const storedEmployeeProfileId = actorProfile.employee_profile_id ?? null;
    if (request.actor.employeeProfileId && request.actor.employeeProfileId !== storedEmployeeProfileId) {
      throw new AppError(403, "actor_context_mismatch", "Контекст сотрудника устарел");
    }

    return resolveCandidate360AccessScope(
      grants.map((grant) => ({ scopeType: grant.scope_type, scopeId: grant.scope_id })),
      request.actor.userAccountId,
      storedEmployeeProfileId,
      this.options.teamScopeResolver,
    );
  }
}
