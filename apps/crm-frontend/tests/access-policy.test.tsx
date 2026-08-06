// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { navigationForSession } from "@/app/navigation";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import type { OwnProfileResponse } from "@/shared/api";
import {
  AuthProvider,
  type AuthSession,
  RequireAuth,
  RequireBusinessRole,
  RequirePermission,
  resolveBusinessRole,
  resolveScopeVisibility,
} from "@/shared/auth";

afterEach(cleanup);

function session(role: "SUPER_ADMIN" | "SPECIALIST", permissions: string[]): AuthSession {
  return {
    authenticationLevel: "mfa",
    businessRole: role,
    displayName: "Тестовый пользователь",
    mutationAccess: "ready",
    roleLabel: role === "SUPER_ADMIN" ? "Супер-администратор" : "Специалист",
    scopeVisibility: role === "SUPER_ADMIN" ? "all" : "assigned",
    user: {
      businessRole: role,
      id: "00000000-0000-4000-8000-000000000501",
      email: "policy@example.test",
      displayName: "Тестовый пользователь",
      employeeProfileId: role === "SPECIALIST" ? "00000000-0000-4000-8000-000000000601" : null,
      roles:
        role === "SUPER_ADMIN" ? ["platform_superadmin", "crm_admin"] : ["crm_project_manager"],
      permissions,
    },
  };
}

describe("two-role access policy", () => {
  it("fails closed unless backend returns an explicit business role", () => {
    expect(resolveBusinessRole({ roles: ["platform_superadmin", "crm_admin"] })).toBeNull();
    expect(resolveBusinessRole({ roles: ["crm_project_manager"] })).toBeNull();
    expect(resolveBusinessRole({ roles: ["crm_lead_specialist"] })).toBeNull();
    expect(resolveBusinessRole({ roles: ["crm_admin"] })).toBeNull();
    expect(resolveBusinessRole({ businessRole: "SUPER_ADMIN", roles: [] })).toBe("SUPER_ADMIN");
    expect(resolveBusinessRole({ businessRole: "SPECIALIST", roles: [] })).toBe("SPECIALIST");
    expect(resolveScopeVisibility({ roles: ["crm_project_manager"] })).toBe("assigned");
    expect(resolveScopeVisibility({ roles: ["crm_lead_specialist"] })).toBe("team");
  });

  it("builds mutually exclusive role-aware navigation", () => {
    const specialist = navigationForSession(
      session("SPECIALIST", [
        "crm.dashboard.read",
        "crm.case.list",
        "crm.task.read",
        "crm.employer.read",
        "crm.report.build",
      ]),
    );
    expect(specialist.map((item) => item.id)).toEqual([
      "work",
      "relocation",
      "people",
      "tasks",
      "employers",
      "reports",
    ]);
    expect(navigationForSession(session("SUPER_ADMIN", []))).toEqual([]);
    const admin = navigationForSession(
      session("SUPER_ADMIN", [
        "identity.employees.read",
        "content.vacancy.read",
        "content.story.read",
      ]),
    );
    expect(admin.map((item) => item.id)).toEqual([
      "admin-users",
      "admin-vacancies",
      "admin-stories",
    ]);
  });

  it("allows SUPER_ADMIN route and denies missing specialist permission", async () => {
    const base = createMockAuthTransport();
    const transport = {
      ...base,
      async getOwnProfile() {
        return {
          userAccountId: "00000000-0000-4000-8000-000000000501",
          email: "admin@example.test",
          authenticationLevel: "mfa",
          roles: ["platform_superadmin", "crm_admin"],
          permissions: [],
          businessRole: "SUPER_ADMIN",
          employeeProfileId: null,
        } as OwnProfileResponse;
      },
    };

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider mode="mock" transport={transport}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route element={<RequireBusinessRole allowed={["SUPER_ADMIN"]} />}>
                <Route path="/admin" element={<h1>Управление пользователями</h1>} />
              </Route>
              <Route
                path="/specialist"
                element={
                  <RequirePermission allOf={["crm.case.list"]}>
                    <h1>Заявки</h1>
                  </RequirePermission>
                }
              />
            </Route>
            <Route path="/cabinet/crm/denied" element={<h1>Доступ запрещён</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Управление пользователями" }),
    ).not.toBeNull();
    await waitFor(() => expect(screen.queryByText("Доступ запрещён")).toBeNull());

    cleanup();
    render(
      <MemoryRouter initialEntries={["/specialist"]}>
        <AuthProvider mode="mock" transport={transport}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route
                path="/specialist"
                element={
                  <RequirePermission allOf={["crm.case.list"]}>
                    <h1>Заявки</h1>
                  </RequirePermission>
                }
              />
            </Route>
            <Route path="/cabinet/crm/denied" element={<h1>Доступ запрещён</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Доступ запрещён" })).not.toBeNull();
  });
});
