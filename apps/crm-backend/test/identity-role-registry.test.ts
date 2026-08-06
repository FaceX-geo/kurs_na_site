import { describe, expect, it } from "vitest";
import {
  approvableRoleOperationIds,
  ROLE_OPERATION_LIST,
  roleOperation,
  roleOperationByOperationId,
} from "../src/modules/identity/admin-role-registry.js";

const EXPECTED_OPERATION_IDS = [
  "AssignPlatformRole",
  "AssignCrmRole",
  "RevokeCrmRole",
  "AssignProjectRole",
  "RevokeProjectRole",
  "AssignInitialCrmAdmin",
  "AssignInitialProjectAdmin",
  "AssignCrmAdminRole",
  "AssignProjectAdminRole",
  "RevokePlatformRole",
  "RevokeCrmAdminRole",
  "RevokeProjectAdminRole",
  "AssignMigrationRole",
  "RevokeMigrationRole",
  "AssignAuditRole",
  "RevokeAuditRole",
] as const;

describe("identity role operation registry", () => {
  it("is a complete, unique registry for all role mutation contracts", () => {
    expect(ROLE_OPERATION_LIST).toHaveLength(EXPECTED_OPERATION_IDS.length);
    expect(new Set(ROLE_OPERATION_LIST.map((definition) => definition.key)).size).toBe(
      ROLE_OPERATION_LIST.length,
    );
    expect(new Set(ROLE_OPERATION_LIST.map((definition) => definition.operationId))).toEqual(
      new Set(EXPECTED_OPERATION_IDS),
    );
    expect(new Set(ROLE_OPERATION_LIST.map((definition) => definition.path)).size).toBe(
      ROLE_OPERATION_LIST.length,
    );
    for (const operationId of EXPECTED_OPERATION_IDS) {
      expect(roleOperationByOperationId(operationId)?.operationId).toBe(operationId);
    }
  });

  it("keeps domain-admin roles out of ordinary assignment endpoints", () => {
    expect(roleOperation("assign_crm").targetRoles.map((role) => role.code)).not.toContain("crm_admin");
    expect(roleOperation("revoke_crm").targetRoles.map((role) => role.code)).not.toContain("crm_admin");
    expect(roleOperation("assign_project").targetRoles.map((role) => role.code)).not.toContain(
      "project_admin",
    );
    expect(roleOperation("revoke_project").targetRoles.map((role) => role.code)).not.toContain(
      "project_admin",
    );
  });

  it("requires a typed eligible approver for every critical operation", () => {
    const critical = ROLE_OPERATION_LIST.filter((definition) => definition.criticalApproval);
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((definition) => definition.approverRole !== undefined)).toBe(true);
    expect(approvableRoleOperationIds(["crm_admin"])).toEqual(
      expect.arrayContaining(["AssignCrmAdminRole", "RevokeCrmAdminRole"]),
    );
    expect(approvableRoleOperationIds(["crm_admin"])).not.toContain("AssignProjectAdminRole");
  });
});
