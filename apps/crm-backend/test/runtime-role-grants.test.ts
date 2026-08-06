import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tableGrantMap(sql: string): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const match of sql.matchAll(
    /EXECUTE 'GRANT ([A-Z, ]+) ON ((?:identity|intake|crm|platform)\.(?:"[a-z_]+"|[a-z_]+)) TO kurs_crm_worker'/gu,
  )) {
    const verbs = match[1];
    const relation = match[2];
    if (!verbs || !relation) continue;
    grants.set(
      relation,
      verbs
        .split(",")
        .map((verb) => verb.trim())
        .sort(),
    );
  }
  return grants;
}

describe("routing-worker least-privilege migration", () => {
  it("grants only the exact routing tables and verbs", async () => {
    const up = await readFile(
      path.join(appRoot, "db/migrations/0130_runtime_least_privilege.up.sql"),
      "utf8",
    );
    expect(Object.fromEntries(tableGrantMap(up))).toEqual({
      "crm.candidate_document": ["INSERT"],
      "crm.candidate_source": ["INSERT"],
      'crm."case"': ["INSERT", "SELECT"],
      "crm.case_person": ["INSERT"],
      "crm.profile": ["INSERT", "SELECT"],
      "crm.program_participation": ["INSERT", "SELECT"],
      "crm.relocation_profile": ["INSERT"],
      "identity.person": ["INSERT", "SELECT"],
      "intake.submission": ["SELECT", "UPDATE"],
      "intake.upload": ["SELECT"],
      "platform.audit_event": ["INSERT", "SELECT"],
      "platform.inbox_event": ["INSERT", "SELECT"],
      "platform.outbox_event": ["INSERT", "SELECT", "UPDATE"],
    });
    expect(up).not.toMatch(
      /GRANT [^']* ON identity\.(?:password_token|user_account|user_role_assignment) TO kurs_crm_worker/gu,
    );
    expect(up).toContain(
      "REVOKE ALL ON ALL SEQUENCES IN SCHEMA identity, intake, crm, platform FROM kurs_crm_worker",
    );
    expect(up).not.toMatch(/GRANT [^']* ON (?:ALL )?SEQUENCES?[^']* TO kurs_crm_worker/gu);
  });

  it("removes inherited/default function access and restores only two routing predicates", async () => {
    const up = await readFile(
      path.join(appRoot, "db/migrations/0130_runtime_least_privilege.up.sql"),
      "utf8",
    );
    expect(up).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE kurs_crm_migrator IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    );
    expect(up).toContain(
      "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA identity, intake, crm, platform FROM PUBLIC",
    );
    const functionGrants = [...up.matchAll(/GRANT EXECUTE ON FUNCTION ([^']+) TO kurs_crm_worker/gu)].map(
      (match) => match[1],
    );
    expect(functionGrants).toEqual([
      "identity.person_has_user_account(uuid)",
      "identity.person_has_employee_profile(uuid)",
    ]);
  });

  it("keeps sensitive identity checks behind hardened predicates", async () => {
    const [worker, guards] = await Promise.all([
      readFile(path.join(appRoot, "src/modules/intake/routing-worker.ts"), "utf8"),
      readFile(path.join(appRoot, "db/migrations/0110_intake_identity_and_case_guards.up.sql"), "utf8"),
    ]);
    expect(worker).not.toContain('.leftJoin("identity.user_account');
    expect(worker).not.toContain('.leftJoin("identity.employee_profile');
    expect(worker).toContain("identity.person_has_user_account(person.id)");
    expect(worker).toContain("identity.person_has_employee_profile(person.id)");
    expect(guards).toContain("SECURITY DEFINER\nSET search_path = pg_catalog");
    expect(guards).toContain("REVOKE ALL ON FUNCTION identity.person_has_user_account(uuid) FROM PUBLIC");
    expect(guards).toContain("REVOKE ALL ON FUNCTION identity.person_has_employee_profile(uuid) FROM PUBLIC");
  });

  it("defines a rollback to the previous broad state without weakening credential isolation", async () => {
    const down = await readFile(
      path.join(appRoot, "db/migrations/0130_runtime_least_privilege.down.sql"),
      "utf8",
    );
    expect(down).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, intake, crm, platform TO kurs_crm_worker",
    );
    expect(down).toContain("REVOKE ALL ON identity.credential_delivery FROM kurs_crm_worker");
    expect(down).not.toMatch(
      /GRANT EXECUTE ON FUNCTION identity\.person_has_(?:user_account|employee_profile)\(uuid\) TO PUBLIC/gu,
    );
  });
});
