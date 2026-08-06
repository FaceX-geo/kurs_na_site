import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appRoot = new URL("../", import.meta.url);

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, appRoot), "utf8");
}

describe("visual and accessibility contract", () => {
  it("ships a reduced-motion path without removing state feedback", async () => {
    const [globalCss, tokensCss] = await Promise.all([
      read("src/styles/global.css"),
      read("src/design/tokens.css"),
    ]);

    expect(globalCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalCss).toContain("animation-duration: 1ms");
    expect(tokensCss).toContain("--crm-motion-distance: 0px");
    expect(tokensCss).toContain("--crm-motion-panel: 1ms");
  });

  it("uses approved raster art rather than inline or CSS-generated imagery", async () => {
    const [appShell, authShell, appShellCss, authCss] = await Promise.all([
      read("src/app/layout/AppShell.tsx"),
      read("src/features/auth/AuthShell.tsx"),
      read("src/app/layout/app-shell.css"),
      read("src/features/auth/auth.css"),
    ]);

    expect(`${appShell}${authShell}`).not.toContain("<svg");
    expect(`${appShellCss}${authCss}`).not.toMatch(/(?:linear|radial|conic)-gradient/);
    expect(appShellCss).toContain("sidebar-aurora-background.png");
    expect(authCss).toContain("murmansk-auth-background.png");
    await Promise.all([
      access(new URL("public/assets/crm/sidebar-aurora-background.png", appRoot)),
      access(new URL("public/assets/crm/murmansk-auth-background.png", appRoot)),
    ]);
  });
});
