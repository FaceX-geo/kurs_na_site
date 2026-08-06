import type { Kysely } from "kysely";
import { AppError } from "../../../common/errors.js";
import type { Database } from "../../../db/types.js";
import type { CrmAccessScope, CrmAuthorizationPort, CrmAuthorizationRequest } from "../ports.js";

export const CRM_FIELD_MASK = Object.freeze({
  PERSON_DISPLAY_NAME: "person.display_name",
  PERSON_CONTACT_MASKED: "person.contact.masked",
  EMPLOYER_TAX_ID_MASKED: "employer.tax_id.masked",
  EMPLOYER_CONTACT_RAW: "employer.contact.raw",
  ACTIVITY_BODY_PREVIEW: "activity.body.preview",
} as const);

export interface CrmTeamScopeResolver {
  resolveEmployeeProfileIds(teamIds: readonly string[]): Promise<readonly string[]>;
}

export interface PostgresCrmAuthorizationOptions {
  readonly teamScopeResolver?: CrmTeamScopeResolver;
}

export function activeTeamEmployeeProfilesQuery(db: Kysely<Database>, teamIds: readonly string[]) {
  return db
    .selectFrom("identity.employee_profile")
    .select("id")
    .where("organization_unit_id", "in", [...teamIds])
    .where("employment_state", "=", "active")
    .where("archived_at", "is", null)
    .orderBy("id", "asc");
}

/**
 * The current CRM model stores the employee's active primary team as an organization-unit id.
 * Keeping the expansion in one adapter makes the temporary representation explicit and gives the
 * future perioded membership model a single replacement point.
 */
export class PostgresCrmTeamScopeResolver implements CrmTeamScopeResolver {
  constructor(private readonly db: Kysely<Database>) {}

  async resolveEmployeeProfileIds(teamIds: readonly string[]): Promise<readonly string[]> {
    if (teamIds.length === 0) {
      return [];
    }
    const rows = await activeTeamEmployeeProfilesQuery(this.db, teamIds).execute();
    return rows.map((row) => row.id);
  }
}

export interface CrmGrantedScope {
  readonly scopeType: string;
  readonly scopeId: string | null;
}

export function fieldMaskForPermission(permissionCode: string): readonly string[] {
  const fields: string[] = [
    CRM_FIELD_MASK.PERSON_DISPLAY_NAME,
    CRM_FIELD_MASK.PERSON_CONTACT_MASKED,
    CRM_FIELD_MASK.EMPLOYER_TAX_ID_MASKED,
  ];
  if (permissionCode === "crm.employer.read") {
    fields.push(CRM_FIELD_MASK.EMPLOYER_CONTACT_RAW);
  }
  if (permissionCode === "crm.communication.read") {
    fields.push(CRM_FIELD_MASK.ACTIVITY_BODY_PREVIEW);
  }
  return Object.freeze(fields);
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function resolveCrmAccessScope(
  request: CrmAuthorizationRequest,
  grants: readonly CrmGrantedScope[],
  actorEmployeeProfileId: string | null,
  teamScopeResolver?: CrmTeamScopeResolver,
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
    actorUserAccountId: request.actor.userAccountId,
    actorEmployeeProfileId,
    employeeProfileIds: Object.freeze(employeeProfileIds),
    teamIds: Object.freeze(teamIds),
    organizationUnitIds: Object.freeze(departmentIds),
    fieldMask: fieldMaskForPermission(request.permissionCode),
  });
}

export class PostgresCrmAuthorizationAdapter implements CrmAuthorizationPort {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: PostgresCrmAuthorizationOptions = {},
  ) {}

  async authorize(request: CrmAuthorizationRequest): Promise<CrmAccessScope> {
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
        .select(["employee.id as employee_profile_id"])
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
        .where("role_permission.permission_code", "=", request.permissionCode)
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
    if (request.actor.employeeProfileId && storedEmployeeProfileId !== request.actor.employeeProfileId) {
      throw new AppError(403, "actor_context_mismatch", "Контекст сотрудника устарел");
    }

    return resolveCrmAccessScope(
      request,
      grants.map((grant) => ({ scopeType: grant.scope_type, scopeId: grant.scope_id })),
      storedEmployeeProfileId,
      this.options.teamScopeResolver,
    );
  }
}
