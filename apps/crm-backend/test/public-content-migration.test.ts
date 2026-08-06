import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_CONTENT_OPERATION_LIST } from "../src/modules/public-content/registry.js";

describe("public content migration 0162", () => {
  it("seeds every registered permission only for the platform superadmin and reverses it", async () => {
    const [up, down] = await Promise.all([
      readFile(path.resolve("db/migrations/0162_public_content.up.sql"), "utf8"),
      readFile(path.resolve("db/migrations/0162_public_content.down.sql"), "utf8"),
    ]);
    const permissions = new Set(PUBLIC_CONTENT_OPERATION_LIST.map((operation) => operation.permissionCode));

    for (const permission of permissions) {
      expect(up).toContain(`'${permission}'`);
      expect(down).toContain(`'${permission}'`);
    }
    expect(up).toContain("('platform_superadmin', 'content.vacancy.read')");
    expect(up).toContain("('platform_superadmin', 'content.story.manage')");
    expect(up).not.toMatch(/\('crm_project_manager',\s*'content\./u);
    expect(up).not.toMatch(/'content\.[^']+',\s*'content'/u);
  });

  it("keeps runtime grants narrow and the revision ledger append-only", async () => {
    const up = await readFile(path.resolve("db/migrations/0162_public_content.up.sql"), "utf8");

    expect(up).toContain("REVOKE ALL ON SCHEMA content FROM PUBLIC");
    expect(up).toContain("REVOKE ALL ON TABLE content.vacancy, content.story, content.revision FROM PUBLIC");
    expect(up).toContain("GRANT SELECT, INSERT, UPDATE ON content.vacancy TO kurs_crm_api");
    expect(up).toContain("GRANT SELECT, INSERT, UPDATE ON content.story TO kurs_crm_api");
    expect(up).toContain("GRANT SELECT, INSERT ON content.revision TO kurs_crm_api");
    expect(up).not.toMatch(/GRANT [^;]*DELETE[^;]*content\./u);
    expect(up).toContain("CREATE TRIGGER reject_public_content_revision_mutation");
    expect(up).toContain("EXECUTE FUNCTION platform.reject_mutation()");
    expect(up).toContain("CREATE TRIGGER enforce_public_content_revision_parent");
    expect(up).toContain("REVOKE ALL ON FUNCTION content.enforce_revision_parent() FROM PUBLIC");
    expect(up).toContain("GRANT EXECUTE ON FUNCTION content.enforce_revision_parent() TO kurs_crm_api");
  });

  it("enforces version and publication-state invariants at the database boundary", async () => {
    const up = await readFile(path.resolve("db/migrations/0162_public_content.up.sql"), "utf8");

    expect(up).toContain("CREATE TRIGGER touch_public_content_vacancy");
    expect(up).toContain("CREATE TRIGGER touch_public_content_story");
    expect(up.match(/EXECUTE FUNCTION platform\.touch_versioned_row\(\)/gu)).toHaveLength(2);
    expect(
      up.match(/publication_state = 'draft' AND published_at IS NULL AND archived_at IS NULL/gu),
    ).toHaveLength(2);
    expect(
      up.match(/publication_state = 'published' AND published_at IS NOT NULL AND archived_at IS NULL/gu),
    ).toHaveLength(2);
    expect(up.match(/publication_state = 'archived' AND archived_at IS NOT NULL/gu)).toHaveLength(2);
    expect(up).toContain("document->>'applicantType' IN ('relocation', 'student')");
    expect(up).toContain("document->>'tone' IN ('berry', 'cyan', 'blue')");
  });

  it("provides an explicit rollback without a broad CASCADE", async () => {
    const down = await readFile(path.resolve("db/migrations/0162_public_content.down.sql"), "utf8");

    expect(down).toContain("DROP TABLE content.revision");
    expect(down).toContain("DROP TABLE content.story");
    expect(down).toContain("DROP TABLE content.vacancy");
    expect(down).toContain("DROP FUNCTION content.enforce_revision_parent()");
    expect(down).toContain("DROP SCHEMA content");
    expect(down).not.toContain("CASCADE");
  });
});
