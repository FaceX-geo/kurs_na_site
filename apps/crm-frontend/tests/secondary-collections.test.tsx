// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunicationsScreen } from "@/features/communications";
import { EmployersScreen } from "@/features/employers";
import { NotificationsScreen } from "@/features/notifications";
import { PeopleRegistryScreen } from "@/features/people";
import {
  type ActivitiesResponse,
  crmApi,
  type EmployersResponse,
  type NotificationsResponse,
  type PeopleResponse,
} from "@/shared/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("secondary CRM collection screens", () => {
  it("reads every people filter from the URL and navigates cached cursor pages", async () => {
    const listPeople = vi
      .spyOn(crmApi, "listPeople")
      .mockImplementation(async (query) =>
        query?.cursor
          ? peoplePage([person("person-2", "Мария Петрова")], null)
          : peoplePage([person("person-1", "Иван Соколов")], "people-next"),
      );
    const user = userEvent.setup();

    renderWithProviders(
      <PeopleRegistryScreen />,
      "/cabinet/crm/people?search=Иван&profile=active&quality=verified&program=student",
    );

    expect(await screen.findByText("Иван Соколов")).not.toBeNull();
    expect(listPeople).toHaveBeenCalledWith({
      limit: 50,
      search: "Иван",
      profileState: "active",
      dataQualityState: "verified",
      programType: "student",
    });
    expect(screen.getByText("Активные фильтры: 4.")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Загрузить следующую" }));

    expect(await screen.findByText("Мария Петрова")).not.toBeNull();
    expect(screen.queryByText("Иван Соколов")).toBeNull();
    expect(listPeople).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "people-next", limit: 50 }),
    );

    await user.click(screen.getByRole("button", { name: "Предыдущая" }));
    expect(await screen.findByText("Иван Соколов")).not.toBeNull();
  });

  it("debounces employer search, keeps URL filters authoritative and clears them together", async () => {
    const listEmployers = vi
      .spyOn(crmApi, "listEmployers")
      .mockResolvedValue(employerPage([employer("employer-1", "Северный порт")], null));
    const user = userEvent.setup();

    renderWithProviders(<EmployersScreen />, "/cabinet/crm/employers?status=needs_review");

    expect(await screen.findByText("Северный порт")).not.toBeNull();
    expect(listEmployers).toHaveBeenCalledWith({ limit: 50, status: "needs_review" });

    await user.type(screen.getByRole("searchbox", { name: "Найти работодателя" }), "Север");
    await waitFor(() =>
      expect(listEmployers).toHaveBeenLastCalledWith({
        limit: 50,
        search: "Север",
        status: "needs_review",
      }),
    );
    expect(screen.getByText("Активные фильтры: 2.")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Сбросить все" }));
    await waitFor(() => expect(listEmployers).toHaveBeenLastCalledWith({ limit: 50 }));
    expect(screen.getByText("Фильтры не применены.")).not.toBeNull();
  });

  it("keeps the current notification page visible when the next cursor request fails", async () => {
    const listNotifications = vi
      .spyOn(crmApi, "listNotifications")
      .mockResolvedValueOnce(
        notificationPage([notification("notification-1", "Первое уведомление")], "notice-next"),
      )
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValueOnce(
        notificationPage([notification("notification-2", "Второе уведомление")], null),
      );
    const user = userEvent.setup();

    renderWithProviders(<NotificationsScreen />, "/cabinet/crm/notifications");
    expect(await screen.findByRole("heading", { name: "Первое уведомление" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Загрузить следующую" }));

    expect(
      await screen.findByRole("heading", { name: "Следующая страница не загружена" }),
    ).not.toBeNull();
    expect(screen.getAllByText("Первое уведомление").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { name: "Второе уведомление" })).not.toBeNull();
    expect(listNotifications).toHaveBeenLastCalledWith({ limit: 50, cursor: "notice-next" });
  });

  it("requests activities with an opaque cursor and advances to the fetched page", async () => {
    const listActivities = vi
      .spyOn(crmApi, "listActivities")
      .mockImplementation(async (query) =>
        query?.cursor
          ? activityPage([activity("activity-2", "Повторный звонок")], null)
          : activityPage([activity("activity-1", "Первичный звонок")], "activity-next"),
      );
    const user = userEvent.setup();

    renderWithProviders(<CommunicationsScreen />, "/cabinet/crm/communications");
    expect(await screen.findByText("Первичный звонок")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Загрузить следующую" }));

    expect(await screen.findByText("Повторный звонок")).not.toBeNull();
    expect(screen.queryByText("Первичный звонок")).toBeNull();
    expect(listActivities).toHaveBeenLastCalledWith({ limit: 50, cursor: "activity-next" });
  });
});

function renderWithProviders(children: ReactNode, initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function peoplePage(items: PeopleResponse["items"], nextCursor: string | null): PeopleResponse {
  return { items, page: { limit: 50, nextCursor, hasMore: nextCursor !== null } };
}

function person(id: string, displayName: string): PeopleResponse["items"][number] {
  return {
    id,
    displayName,
    contactMask: { email: "user@example.test", phone: null },
    profileState: "active",
    dataQualityState: "verified",
    activeCaseCount: 1,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-07T08:00:00.000Z",
  };
}

function employerPage(
  items: EmployersResponse["items"],
  nextCursor: string | null,
): EmployersResponse {
  return { items, page: { limit: 50, nextCursor, hasMore: nextCursor !== null } };
}

function employer(id: string, name: string): EmployersResponse["items"][number] {
  return {
    id,
    publicId: `EMP-${id}`,
    name,
    legalName: null,
    taxIdMask: null,
    status: "needs_review",
    organizationType: "legal_entity",
    contactCount: 1,
    openReferralCount: 2,
    version: 1,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-07T08:00:00.000Z",
  };
}

function notificationPage(
  items: NotificationsResponse["items"],
  nextCursor: string | null,
): NotificationsResponse {
  return { items, page: { limit: 50, nextCursor, hasMore: nextCursor !== null } };
}

function notification(id: string, title: string): NotificationsResponse["items"][number] {
  return {
    id,
    publicId: `NTF-${id}`,
    typeCode: "case.stage_changed",
    title,
    payload: { summary: title },
    readAt: null,
    occurredAt: "2026-08-07T08:00:00.000Z",
    version: 1,
  };
}

function activityPage(
  items: ActivitiesResponse["items"],
  nextCursor: string | null,
): ActivitiesResponse {
  return { items, page: { limit: 50, nextCursor, hasMore: nextCursor !== null } };
}

function activity(id: string, subject: string): ActivitiesResponse["items"][number] {
  return {
    id,
    publicId: `ACT-${id}`,
    caseId: null,
    personId: null,
    employerId: null,
    employerReferralId: null,
    activityType: "communication",
    direction: "outbound",
    subject,
    bodyPreview: "Комментарий специалиста",
    deliveryState: "recorded",
    occurredAt: "2026-08-07T08:00:00.000Z",
    actorEmployeeProfileId: null,
    legacyActorId: null,
    provenance: { source: "test" },
  };
}
