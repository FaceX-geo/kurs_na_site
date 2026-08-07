// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminVacanciesScreen, SecuritySettingsScreen } from "@/features/settings";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import {
  type AdminVacanciesResponse,
  crmApi,
  type OwnProfileResponse,
  type OwnSessionListResponse,
} from "@/shared/api";
import { AuthProvider } from "@/shared/auth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SUPER_ADMIN content cursor collection", () => {
  it("owns the state filter in the URL and navigates cached vacancy pages", async () => {
    const vacancies = vi
      .spyOn(crmApi, "listAdminVacancies")
      .mockImplementation(async (query = {}) => {
        if (query.state === "published") return vacancyPage("Опубликованная вакансия", null);
        if (query.cursor) return vacancyPage("Вакансия второй страницы", null);
        return vacancyPage("Вакансия первой страницы", "vacancies-cursor-2");
      });

    renderVacancies("/cabinet/crm/admin/vacancies?state=draft");

    expect(await screen.findByText("Вакансия первой страницы")).not.toBeNull();
    expect(vacancies).toHaveBeenLastCalledWith({ limit: 100, state: "draft" });
    expect(screen.getByTestId("location-search").textContent).toBe("?state=draft");

    const pagination = screen.getByRole("navigation", { name: "Пагинация: Вакансии лендинга" });
    fireEvent.click(within(pagination).getByRole("button", { name: "Загрузить следующую" }));
    expect(await screen.findByText("Вакансия второй страницы")).not.toBeNull();
    expect(screen.queryByText("Вакансия первой страницы")).toBeNull();
    expect(vacancies).toHaveBeenLastCalledWith({
      limit: 100,
      cursor: "vacancies-cursor-2",
      state: "draft",
    });

    fireEvent.click(within(pagination).getByRole("button", { name: "Предыдущая" }));
    expect(await screen.findByText("Вакансия первой страницы")).not.toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Статус материала" }), {
      target: { value: "published" },
    });
    expect(await screen.findByText("Опубликованная вакансия")).not.toBeNull();
    expect(screen.getByTestId("location-search").textContent).toBe("?state=published");
    expect(vacancies).toHaveBeenLastCalledWith({ limit: 100, state: "published" });
  });
});

describe("own sessions cursor collection", () => {
  it("requests the backend cursor and keeps previous session pages navigable", async () => {
    const sessions = vi
      .spyOn(crmApi, "listOwnSessions")
      .mockImplementation(async (query = {}) =>
        query.cursor
          ? sessionPage("00000000-0000-4000-8000-000000000902", null)
          : sessionPage("00000000-0000-4000-8000-000000000901", "sessions-cursor-2"),
      );

    renderSecurity();

    expect(
      await screen.findByText("Идентификатор: 00000000-0000-4000-8000-000000000901"),
    ).not.toBeNull();
    expect(sessions).toHaveBeenLastCalledWith({ limit: 100 });

    const pagination = screen.getByRole("navigation", { name: "Пагинация собственных сеансов" });
    fireEvent.click(within(pagination).getByRole("button", { name: "Загрузить следующую" }));
    expect(
      await screen.findByText("Идентификатор: 00000000-0000-4000-8000-000000000902"),
    ).not.toBeNull();
    expect(screen.queryByText("Идентификатор: 00000000-0000-4000-8000-000000000901")).toBeNull();
    expect(sessions).toHaveBeenLastCalledWith({ limit: 100, cursor: "sessions-cursor-2" });

    fireEvent.click(within(pagination).getByRole("button", { name: "Предыдущая" }));
    expect(
      await screen.findByText("Идентификатор: 00000000-0000-4000-8000-000000000901"),
    ).not.toBeNull();
  });
});

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

function renderVacancies(initialEntry: string) {
  const base = createMockAuthTransport();
  const transport = {
    ...base,
    async getOwnProfile() {
      return {
        userAccountId: "00000000-0000-4000-8000-000000000501",
        email: "admin@example.test",
        authenticationLevel: "fresh_mfa",
        roles: ["platform_superadmin", "crm_admin"],
        permissions: ["content.vacancy.read", "content.vacancy.manage"],
        businessRole: "SUPER_ADMIN",
        employeeProfileId: null,
        scopeVisibility: "all",
      } as OwnProfileResponse;
    },
  };

  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider mode="mock" transport={transport}>
          <AdminVacanciesScreen />
          <LocationSearch />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSecurity() {
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter>
        <SecuritySettingsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function vacancyPage(title: string, nextCursor: string | null): AdminVacanciesResponse {
  return {
    items: [
      {
        id: "00000000-0000-4000-8000-000000000801",
        publicId: `vacancy-${title}`,
        sector: "industry",
        title,
        city: "Мурманск",
        employer: "Тестовый работодатель",
        salaryText: "По договорённости",
        summary: "Описание вакансии",
        responsibilities: ["Работать"],
        requirements: ["Опыт"],
        conditions: ["Оформление"],
        applicantType: "relocation",
        sphere: "Промышленность",
        state: title.startsWith("Опубликованная") ? "published" : "draft",
        version: 1,
        publishedAt: title.startsWith("Опубликованная") ? "2026-08-07T08:00:00.000Z" : null,
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-07T08:00:00.000Z",
      },
    ],
    page: { limit: 100, nextCursor, hasMore: nextCursor !== null },
  };
}

function sessionPage(id: string, nextCursor: string | null): OwnSessionListResponse {
  return {
    items: [
      {
        id,
        authenticationLevel: "fresh_mfa",
        createdAt: "2026-08-06T08:00:00.000Z",
        lastSeenAt: "2026-08-07T08:00:00.000Z",
        absoluteExpiresAt: "2026-08-08T08:00:00.000Z",
        revokedAt: null,
      },
    ],
    page: { limit: 100, nextCursor, hasMore: nextCursor !== null },
  };
}
