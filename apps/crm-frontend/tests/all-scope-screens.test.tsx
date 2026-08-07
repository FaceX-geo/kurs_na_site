// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CasesScreen } from "@/features/cases";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import { crmApi, type OwnProfileResponse } from "@/shared/api";
import { AuthProvider } from "@/shared/auth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SUPER_ADMIN all-scope screens", () => {
  it("shows the all-CRM case registry without enabling ungranted transitions", async () => {
    vi.spyOn(crmApi, "listCases").mockResolvedValue({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000111",
          publicId: "CASE-111",
          title: "Заявка из мигрированной БД",
          funnelCode: "relocation",
          funnelVersion: 1,
          stageCode: "new",
          status: "open",
          nextStep: null,
          primaryPersonId: "00000000-0000-4000-8000-000000000211",
          ownerEmployeeProfileId: "00000000-0000-4000-8000-000000000311",
          version: 1,
          createdAt: "2026-08-06T08:00:00.000Z",
          updatedAt: "2026-08-07T08:00:00.000Z",
        },
      ],
      page: { limit: 200, nextCursor: null, hasMore: false },
    });
    vi.spyOn(crmApi, "listFunnels").mockResolvedValue({
      items: [
        {
          code: "relocation",
          version: 1,
          title: "Переезд",
          status: "active",
          source: "registry",
          initialState: "new",
          states: [
            { code: "new", title: "Новая", order: 1, aggregateStatus: "open" },
            { code: "done", title: "Завершена", order: 2, aggregateStatus: "completed" },
          ],
          transitions: [
            {
              code: "complete",
              from: ["new"],
              to: ["done"],
              permissionCode: "crm.case.transition",
              requiredFields: [],
              reasonRequired: false,
            },
          ],
        },
      ],
    });

    renderAllScopeCases();

    expect(await screen.findByRole("heading", { name: "Все заявки и воронки" })).not.toBeNull();
    expect(await screen.findByText("Заявка из мигрированной БД")).not.toBeNull();
    const transition = screen.getByRole("combobox", {
      name: "Изменить этап заявки CASE-111 через preview",
    }) as HTMLSelectElement;
    expect(transition.disabled).toBe(true);
  });
});

function renderAllScopeCases() {
  const base = createMockAuthTransport();
  const transport = {
    ...base,
    async getOwnProfile() {
      return {
        userAccountId: "00000000-0000-4000-8000-000000000501",
        email: "admin@example.test",
        authenticationLevel: "mfa",
        roles: ["platform_superadmin", "crm_admin"],
        permissions: ["crm.case.list", "crm.case.read"],
        businessRole: "SUPER_ADMIN",
        employeeProfileId: null,
        scopeVisibility: "all",
      } as OwnProfileResponse;
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/cabinet/crm/relocation?view=list"]}>
        <AuthProvider mode="mock" transport={transport}>
          <CasesScreen />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
