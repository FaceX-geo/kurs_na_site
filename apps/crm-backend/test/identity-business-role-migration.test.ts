import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDENTITY_OPERATIONS } from "../src/modules/identity/operation-registry.js";

describe("business-role and specialist provisioning migration", () => {
  it("seeds reversible permissions and enforces one active product role per account", async () => {
    const [up, down] = await Promise.all([
      readFile(path.resolve("db/migrations/0160_business_roles_and_specialist_provisioning.up.sql"), "utf8"),
      readFile(
        path.resolve("db/migrations/0160_business_roles_and_specialist_provisioning.down.sql"),
        "utf8",
      ),
    ]);
    for (const permission of [
      IDENTITY_OPERATIONS["employees.list"].permissionCode,
      IDENTITY_OPERATIONS["specialists.provision"].permissionCode,
    ]) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    expect(up).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(up).toContain("identity_business_role_interval_excl");
    expect(up).toContain("EXCLUDE USING gist");
    expect(up).toContain("tstzrange(valid_from, valid_to, '[)') WITH &&");
    expect(up).toContain("tstzrange(left_assignment.valid_from, left_assignment.valid_to, '[)')");
    expect(up).toContain("'platform_superadmin', 'crm_project_manager'");
    expect(up).toContain("employee_provisioning_keyset_idx");
    expect(up).toContain("identity.enforce_active_business_role_assignment");
    expect(up).toContain("NEW.scope_type <> 'assigned'");
    expect(up).toContain("account.person_id = employee.person_id");
    expect(up).toContain("NEW.valid_to <= clock_timestamp()");
    expect(up).toContain("NEW.scope_type <> 'all' OR NEW.scope_id IS NOT NULL");
    expect(down).toContain("DROP TRIGGER IF EXISTS enforce_active_business_role_assignment");
    expect(down).toContain("DROP FUNCTION IF EXISTS identity.enforce_active_business_role_assignment");
    expect(down).toContain("DROP CONSTRAINT IF EXISTS identity_business_role_interval_excl");
  });
});
