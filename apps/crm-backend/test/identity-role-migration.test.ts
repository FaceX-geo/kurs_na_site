import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_OPERATION_LIST, ROLE_PREVIEW_OPERATION } from "../src/modules/identity/admin-role-registry.js";

describe("identity role provisioning migration", () => {
  it("keeps every registered permission reversible and seeds every target role", async () => {
    const [core, identityAdmin, up] = await Promise.all([
      readFile(path.resolve("db/migrations/0001_core.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0010_identity_admin.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0060_identity_role_provisioning.up.sql"), "utf8"),
    ]);
    const down = await readFile(
      path.resolve("db/migrations/0060_identity_role_provisioning.down.sql"),
      "utf8",
    );
    const permissions = new Set([
      ROLE_PREVIEW_OPERATION.permissionCode,
      ...ROLE_OPERATION_LIST.map((operation) => operation.permissionCode),
    ]);
    const roles = new Set(
      ROLE_OPERATION_LIST.flatMap((operation) => operation.targetRoles.map((role) => role.code)),
    );

    for (const permission of permissions) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    for (const role of roles) {
      expect(`${core}\n${identityAdmin}\n${up}`).toContain(`'${role}'`);
    }
    for (const domainApproverRole of ["crm_admin", "project_admin"]) {
      expect(up).toContain(`('${domainApproverRole}', 'identity.approvals.decide')`);
      expect(down).toContain(`('${domainApproverRole}', 'identity.approvals.decide')`);
    }
  });
});
