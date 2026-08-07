import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDENTITY_POLICY_VERSION } from "../src/modules/identity/admin-policy.js";

const SUPERADMIN_CRM_PERMISSIONS = [
  "crm.case.list",
  "crm.case.read",
  "crm.person.pii_view",
  "crm.employer.read",
  "crm.task.read",
  "crm.communication.read",
  "crm.dashboard.read",
  "crm.notification.read",
  "crm.report.build",
] as const;

const FORBIDDEN_BUSINESS_WRITES = [
  "crm.case.transition",
  "crm.case.reopen",
  "crm.task.manage",
  "crm.communication.manage",
  "crm.communication.confirm",
  "crm.communication.send",
] as const;

interface AuthorizationPolicyCatalog {
  readonly policy_version: string;
  readonly roles: Readonly<Record<string, { readonly explicit_crm_permissions?: readonly string[] }>>;
  readonly permissions: readonly { readonly code: string; readonly roles: readonly string[] }[];
}

function grantedPermissions(sql: string): string[] {
  return [...sql.matchAll(/\('platform_superadmin',\s*'([^']+)'\)/gu)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function deletedPermissions(sql: string): string[] {
  const block = /DELETE FROM identity\.role_permission[\s\S]*?permission_code IN \(([\s\S]*?)\);/u.exec(
    sql,
  )?.[1];
  if (!block) throw new Error("Expected a bounded role_permission rollback");
  return [...block.matchAll(/'([^']+)'/gu)].flatMap((match) => (match[1] ? [match[1]] : []));
}

describe("SUPER_ADMIN CRM read policy migration 0163", () => {
  it("grants and rolls back exactly the approved read/report allowlist", async () => {
    const [up, down] = await Promise.all([
      readFile(path.resolve("db/migrations/0163_superadmin_crm_read_access.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0163_superadmin_crm_read_access.down.sql"), "utf8"),
    ]);

    expect(grantedPermissions(up)).toEqual(SUPERADMIN_CRM_PERMISSIONS);
    expect(deletedPermissions(down)).toEqual(SUPERADMIN_CRM_PERMISSIONS);
    for (const permission of FORBIDDEN_BUSINESS_WRITES) {
      expect(grantedPermissions(up)).not.toContain(permission);
    }
    expect(down).not.toContain("DELETE FROM identity.permission");
    expect(down).not.toContain("DELETE FROM identity.user_role_assignment");
    expect(up).toContain("all-scope чтение CRM");
  });

  it("keeps the machine policy and runtime audit policy on the same version", async () => {
    const catalog = JSON.parse(
      await readFile(path.resolve("../../docs/cabinet/generated/authorization-policy-catalog.json"), "utf8"),
    ) as AuthorizationPolicyCatalog;

    expect(catalog.policy_version).toBe("1.3.0");
    expect(IDENTITY_POLICY_VERSION).toBe(catalog.policy_version);
    expect(catalog.roles.platform_superadmin?.explicit_crm_permissions).toEqual(SUPERADMIN_CRM_PERMISSIONS);
    for (const permission of SUPERADMIN_CRM_PERMISSIONS) {
      expect(catalog.permissions.find((item) => item.code === permission)?.roles).toContain(
        "platform_superadmin",
      );
    }
    for (const permission of FORBIDDEN_BUSINESS_WRITES) {
      expect(catalog.permissions.find((item) => item.code === permission)?.roles ?? []).not.toContain(
        "platform_superadmin",
      );
    }
  });
});
