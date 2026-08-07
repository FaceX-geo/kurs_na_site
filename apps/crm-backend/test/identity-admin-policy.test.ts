import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors.js";
import {
  approvalPayloadHash,
  assertFreshMfa,
  assertNoSelf,
  assertPasswordPolicy,
  effectiveAccessFingerprint,
  hasPrivilegedRole,
} from "../src/modules/identity/admin-policy.js";
import { credentialDeliveryPayload } from "../src/modules/identity/admin-service.js";
import type { AuthContext } from "../src/modules/identity/service.js";

function context(authenticationLevel: AuthContext["authenticationLevel"]): AuthContext {
  return {
    sessionId: "019fd7d0-6789-7000-8000-000000000001",
    userAccountId: "019fd7d0-6789-7000-8000-000000000002",
    personId: "019fd7d0-6789-7000-8000-000000000003",
    email: "admin@example.test",
    authenticationLevel,
    csrfTokenHash: "a".repeat(64),
    roles: ["platform_superadmin"],
    permissions: ["identity.users.disable"],
    businessRole: "SUPER_ADMIN",
    employeeProfileId: null,
  };
}

describe("identity admin policy", () => {
  it("denies operations over the actor's own account", () => {
    expect(() => assertNoSelf("same", "same")).toThrowError(AppError);
  });

  it("requires a short-lived fresh MFA session for privileged writes", () => {
    expect(() => assertFreshMfa(context("mfa"))).toThrowError(
      expect.objectContaining({ code: "fresh_mfa_required", statusCode: 403 }),
    );
    expect(() => assertFreshMfa(context("fresh_mfa"))).not.toThrow();
  });

  it("rejects weak and identity-derived passwords", () => {
    expect(() => assertPasswordPolicy("short")).toThrowError(
      expect.objectContaining({ code: "password_policy_failed" }),
    );
    expect(() => assertPasswordPolicy("Admin-Long-Random-Value", "admin@example.test")).toThrowError(
      expect.objectContaining({ code: "password_policy_failed" }),
    );
    expect(() => assertPasswordPolicy("Frost!Harbor!Lighthouse!27", "admin@example.test")).not.toThrow();
  });

  it("hashes an approval payload canonically", () => {
    const left = approvalPayloadHash({ subjectId: "subject", reason: "handover", version: 3 });
    const right = approvalPayloadHash({ version: 3, reason: "handover", subjectId: "subject" });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds effective-access previews canonically to policy and proposed access", () => {
    const left = effectiveAccessFingerprint({
      subjectId: "subject",
      operationId: "AssignCrmRole",
      proposedPermissions: ["crm.case.read"],
    });
    const right = effectiveAccessFingerprint({
      proposedPermissions: ["crm.case.read"],
      operationId: "AssignCrmRole",
      subjectId: "subject",
    });
    const changed = effectiveAccessFingerprint({
      subjectId: "subject",
      operationId: "AssignCrmRole",
      proposedPermissions: ["crm.case.read", "crm.case.update"],
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(changed).not.toBe(left);
  });

  it("classifies typed privileged roles without treating ordinary CRM access as platform access", () => {
    expect(hasPrivilegedRole(["crm_project_manager"])).toBe(false);
    expect(hasPrivilegedRole(["crm_project_manager", "crm_admin"])).toBe(true);
  });

  it("puts a non-secret token id in delivery metadata without persisting a raw credential", () => {
    const payload = credentialDeliveryPayload({
      userAccountId: "019fd7d0-6789-7000-8000-000000000004",
      credentialTokenId: "019fd7d0-6789-7000-8000-000000000005",
      purpose: "invite",
    });
    expect(payload).toMatchObject({
      credentialTokenId: "019fd7d0-6789-7000-8000-000000000005",
      purpose: "invite",
    });
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["token", "rawToken", "credential"]));
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["destination", "email"]));
    expect(JSON.stringify(payload)).not.toContain("person@example.test");
    expect(JSON.stringify(payload)).not.toContain("identity-credential:");
  });
});
