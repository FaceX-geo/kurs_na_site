import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyUiRegistry } from "../scripts/verify-ui-registry.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(testDirectory, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(appRoot, relativePath), "utf8"));
}

describe("CRM UI registry", () => {
  it("connects all 51 reference screens to registered UI and verified backend operations", async () => {
    const result = await verifyUiRegistry({ appRoot });

    expect(result).toMatchObject({ components: 15, screens: 51, recipes: 7 });
    expect(result.operationIds).toBeGreaterThan(0);
  });

  it("keeps screens 45–48 inside the isolated MAX test boundary", async () => {
    const registry = await readJson("registry/screens.json");
    const authScreens = registry.screens.filter(
      (screen) => screen.number >= 45 && screen.number <= 48,
    );

    expect(authScreens).toHaveLength(4);
    expect(authScreens.map((screen) => screen.operationIds)).toEqual([
      ["Login"],
      ["VerifyMfa"],
      [],
      ["EnrollMfa"],
    ]);
    expect(authScreens.every((screen) => screen.shell === "auth")).toBe(true);
    expect(authScreens.every((screen) => !screen.componentIds.includes("ui.app-shell"))).toBe(true);
    expect(authScreens.flatMap((screen) => screen.operationIds)).toContain("EnrollMfa");
  });

  it("documents that a test MFA bypass is visible and server-gated", async () => {
    const contract = await readJson("registry/contracts/auth-max.contract.json");
    const implementation = await readFile(
      path.resolve(appRoot, "src/shared/ui/AuthMaxPanel.tsx"),
      "utf8",
    );

    expect(contract.invariants.join(" ")).toContain("CRM_TEST_AUTH_BYPASS=true");
    expect(contract.invariants.join(" ")).toContain("TOTP");
    expect(implementation).toContain("Тестовый режим");
    expect(implementation).toContain("недоступно в production");
  });

  it("registers the actual runtime AppShell instead of a disconnected sample", async () => {
    const registry = await readJson("registry/components.json");
    const shell = registry.components.find((component) => component.id === "ui.app-shell");

    expect(shell.implementationPath).toBe("src/app/layout/AppShell.tsx");
    const implementation = await readFile(path.resolve(appRoot, shell.implementationPath), "utf8");
    expect(implementation).toContain("navigationForSession(session)");
    expect(implementation).toContain("Быстрый переход");
  });
});
