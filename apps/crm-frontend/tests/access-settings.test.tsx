// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessSettingsScreen } from "@/features/settings";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import {
  crmApi,
  type OwnProfileResponse,
  type ProvisionableEmployeesResponse,
  type UsersResponse,
} from "@/shared/api";
import { AuthProvider } from "@/shared/auth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SUPER_ADMIN access registries", () => {
  it("loads migrated employees before the create-specialist modal and preserves cursor paging", async () => {
    vi.spyOn(crmApi, "listUsers").mockResolvedValue(emptyUsersPage());
    const employees = vi
      .spyOn(crmApi, "listProvisionableEmployees")
      .mockImplementation(async (query = {}) =>
        query.cursor
          ? employeePage(
              [
                {
                  employeeProfileId: "00000000-0000-4000-8000-000000000702",
                  personId: "00000000-0000-4000-8000-000000000802",
                  displayName: "Пётр Соколов",
                  email: "petr.sokolov@example.test",
                  employeeNumber: "M-102",
                  organizationUnitId: null,
                  employmentState: "active",
                  createdAt: "2026-08-06T09:00:00.000Z",
                },
              ],
              null,
            )
          : employeePage(
              [
                {
                  employeeProfileId: "00000000-0000-4000-8000-000000000701",
                  personId: "00000000-0000-4000-8000-000000000801",
                  displayName: "Ирина Волкова",
                  email: null,
                  employeeNumber: "M-101",
                  organizationUnitId: "00000000-0000-4000-8000-000000000901",
                  employmentState: "active",
                  createdAt: "2026-08-06T08:00:00.000Z",
                },
              ],
              "employees-cursor-2",
            ),
      );

    renderAccessSettings();

    expect(
      await screen.findByRole("heading", { name: "Сотрудники из мигрированной БД" }),
    ).not.toBeNull();
    expect(await screen.findByText("Ирина Волкова")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(employees).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getAllByText("Не указан").length).toBeGreaterThan(0);

    const employeePagination = screen.getByRole("navigation", {
      name: "Пагинация сотрудников из мигрированной БД",
    });
    fireEvent.click(
      within(employeePagination).getByRole("button", { name: "Загрузить следующую" }),
    );
    expect(await screen.findByText("Пётр Соколов")).not.toBeNull();
    expect(screen.queryByText("Ирина Волкова")).toBeNull();
    expect(employees).toHaveBeenLastCalledWith({ limit: 100, cursor: "employees-cursor-2" });

    fireEvent.click(within(employeePagination).getByRole("button", { name: "Предыдущая" }));
    expect(await screen.findByText("Ирина Волкова")).not.toBeNull();
    expect(screen.queryByText("Пётр Соколов")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Создать специалиста" }));
    const dialog = await screen.findByRole("dialog", { name: "Создать специалиста" });
    expect(within(dialog).getByText("Ирина Волкова")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Ирина Волкова/ }));
    await waitFor(() => {
      expect(
        (within(dialog).getByRole("textbox", { name: "Рабочий email" }) as HTMLInputElement).value,
      ).toBe("");
    });
  });

  it("keeps the cached user page visible when loading the next cursor fails", async () => {
    vi.spyOn(crmApi, "listProvisionableEmployees").mockResolvedValue(employeePage([], null));
    const users = vi
      .spyOn(crmApi, "listUsers")
      .mockResolvedValueOnce(userPage("Анна Смирнова", "users-cursor-2"))
      .mockRejectedValueOnce(new Error("Временная ошибка продолжения"));

    renderAccessSettings();

    expect(await screen.findByText("Анна Смирнова")).not.toBeNull();
    const pagination = screen.getByRole("navigation", { name: "Пагинация пользователей CRM" });
    fireEvent.click(within(pagination).getByRole("button", { name: "Загрузить следующую" }));

    expect(await screen.findByText("Следующая страница пользователей не загружена")).not.toBeNull();
    expect(screen.getByText("Анна Смирнова")).not.toBeNull();
    expect(users).toHaveBeenLastCalledWith({ limit: 200, cursor: "users-cursor-2" });
  });
});

function renderAccessSettings() {
  const base = createMockAuthTransport();
  const transport = {
    ...base,
    async getOwnProfile() {
      return {
        userAccountId: "00000000-0000-4000-8000-000000000501",
        email: "admin@example.test",
        authenticationLevel: "fresh_mfa",
        roles: ["platform_superadmin", "crm_admin"],
        permissions: [
          "identity.users.read",
          "identity.employees.read",
          "identity.specialists.provision",
        ],
        businessRole: "SUPER_ADMIN",
        employeeProfileId: null,
        scopeVisibility: "all",
      } as OwnProfileResponse;
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider mode="mock" transport={transport}>
          <AccessSettingsScreen />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function emptyUsersPage(): UsersResponse {
  return {
    items: [],
    page: { limit: 200, nextCursor: null, hasMore: false },
  };
}

function userPage(displayName: string, nextCursor: string | null): UsersResponse {
  return {
    items: [
      {
        id: "00000000-0000-4000-8000-000000000601",
        displayName,
        email: "anna@example.test",
        username: "anna",
        accountState: "active",
        credentialState: "active",
        riskState: "normal",
        mfaState: "enrolled",
        employmentState: "active",
        roles: ["crm_specialist"],
        businessRole: "SPECIALIST",
        employeeProfileId: "00000000-0000-4000-8000-000000000701",
        activeSessions: 1,
        version: 1,
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-07T08:00:00.000Z",
      },
    ],
    page: { limit: 200, nextCursor, hasMore: nextCursor !== null },
  };
}

function employeePage(
  items: ProvisionableEmployeesResponse["items"],
  nextCursor: string | null,
): ProvisionableEmployeesResponse {
  return {
    items,
    page: { limit: 100, nextCursor, hasMore: nextCursor !== null },
  };
}
