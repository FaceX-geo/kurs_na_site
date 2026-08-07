import { describe, expect, it } from "vitest";
import {
  BUSINESS_ROLE_CODES,
  BusinessRoleConflictError,
  internalRoleForBusinessRole,
  resolveBusinessRole,
} from "../src/modules/identity/business-role-registry.js";

describe("identity business-role registry", () => {
  it("projects exactly two product roles from the stable internal roles", () => {
    expect(BUSINESS_ROLE_CODES).toEqual(["SUPER_ADMIN", "SPECIALIST"]);
    expect(internalRoleForBusinessRole("SUPER_ADMIN")).toBe("platform_superadmin");
    expect(internalRoleForBusinessRole("SPECIALIST")).toBe("crm_project_manager");
    expect(resolveBusinessRole(["platform_superadmin", "audit_reader"])).toBe("SUPER_ADMIN");
    expect(resolveBusinessRole(["crm_project_manager", "migration_operator"])).toBe("SPECIALIST");
  });

  it("keeps technical roles internal and fails closed on ambiguous product access", () => {
    expect(resolveBusinessRole(["crm_admin", "audit_reader", "migration_operator"])).toBeNull();
    expect(() => resolveBusinessRole(["platform_superadmin", "crm_project_manager"])).toThrowError(
      BusinessRoleConflictError,
    );
  });
});
