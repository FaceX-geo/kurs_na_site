// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsScreen } from "@/features/reports";
import { crmApi, type ReportRunResponse, type ReportRunsResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReportsScreen", () => {
  it("shows all seven report contracts and paginates history with the backend cursor", async () => {
    const firstRun = reportRun({ id: "run-1", publicId: "RPT-001" });
    const secondRun = reportRun({
      id: "run-2",
      publicId: "RPT-002",
      reportCode: "data_quality.summary",
    });
    const listReportRuns = vi
      .spyOn(crmApi, "listReportRuns")
      .mockImplementation(async (query) =>
        query?.cursor
          ? reportPage([secondRun], null)
          : reportPage([firstRun], "next-report-cursor"),
      );

    const user = userEvent.setup();
    renderReports();

    for (const title of [
      "Воронка заявок",
      "Нагрузка специалистов",
      "Результаты направлений",
      "Источники заявок",
      "Активность работодателей",
      "Результаты переезда",
      "Качество данных",
    ]) {
      expect(await screen.findByRole("button", { name: new RegExp(title) })).not.toBeNull();
    }
    expect(await screen.findByText("RPT-001")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Загрузить следующую" }));

    expect(await screen.findByText("RPT-002")).not.toBeNull();
    expect(listReportRuns).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "next-report-cursor", limit: 25 }),
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Статус" }), "failed");
    await waitFor(() =>
      expect(listReportRuns).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed", limit: 25 }),
      ),
    );
  });

  it("does not build during draft or preview and shows a server receipt after explicit confirm", async () => {
    const builtRun = reportRun({
      id: "run-built",
      publicId: "RPT-BUILT",
      result: { total: 42, stages: [{ code: "new", count: 12 }] },
    });
    vi.spyOn(crmApi, "listReportRuns").mockResolvedValue(reportPage([], null));
    const buildReport = vi.spyOn(crmApi, "buildReport").mockResolvedValue(builtRun);
    const getReportRun = vi.spyOn(crmApi, "getReportRun").mockResolvedValue(builtRun);

    const user = userEvent.setup();
    renderReports();

    await user.type(screen.getByRole("textbox", { name: "Код воронки" }), "relocation");
    await user.type(
      screen.getByRole("textbox", { name: /Причина запуска/ }),
      "Еженедельная сверка",
    );
    expect(buildReport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Проверить изменения" }));
    expect(buildReport).not.toHaveBeenCalled();
    expect(screen.getByText("funnelCode: relocation")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Построить и сохранить" }));

    expect(await screen.findByRole("heading", { name: "Отчёт построен сервером" })).not.toBeNull();
    expect(buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportCode: "pipeline.summary",
        filters: { funnelCode: "relocation" },
        reason: "Еженедельная сверка",
      }),
      expect.any(String),
    );
    expect((await screen.findAllByText("RPT-BUILT")).length).toBeGreaterThan(0);
    expect(getReportRun).toHaveBeenCalledWith("run-built");
    expect(await screen.findByText("stages[0].count")).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
  });

  it("re-reads a selected run, marks an old snapshot stale and renders nested API values", async () => {
    const staleRun = reportRun({
      id: "run-stale",
      publicId: "RPT-STALE",
      dataFreshAt: "2026-01-01T00:00:00.000Z",
      result: { totals: { open: 7, completed: 3 } },
    });
    vi.spyOn(crmApi, "listReportRuns").mockResolvedValue(reportPage([staleRun], null));
    const getReportRun = vi.spyOn(crmApi, "getReportRun").mockResolvedValue(staleRun);

    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole("row", { name: "Открыть Воронка заявок RPT-STALE" }));

    expect(await screen.findByRole("heading", { name: "Снимок старше 24 часов" })).not.toBeNull();
    expect(getReportRun).toHaveBeenCalledWith("run-stale");
    expect(screen.getByText("totals.open")).not.toBeNull();
    expect(screen.getByText("totals.completed")).not.toBeNull();
  });

  it("keeps permission denial explicit and does not expose hidden run counts", async () => {
    vi.spyOn(crmApi, "listReportRuns").mockRejectedValue(
      new ApiError("FORBIDDEN", "Forbidden", { status: 403 }),
    );

    renderReports();

    expect(await screen.findByRole("heading", { name: "Недостаточно прав" })).not.toBeNull();
    expect(screen.queryByText(/Показано: [1-9]/)).toBeNull();
  });
});

function renderReports() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsScreen />
    </QueryClientProvider>,
  );
}

function reportPage(items: ReportRunResponse[], nextCursor: string | null): ReportRunsResponse {
  return {
    items,
    page: { limit: 25, nextCursor, hasMore: nextCursor !== null },
  };
}

function reportRun(overrides: Partial<ReportRunResponse> = {}): ReportRunResponse {
  return {
    id: "run-default",
    publicId: "RPT-DEFAULT",
    reportCode: "pipeline.summary",
    formulaVersion: "pipeline-v1",
    timezone: "Europe/Moscow",
    filters: {},
    scopeVisibility: "assigned",
    state: "completed",
    result: { total: 10 },
    excludedRecords: 0,
    dataFreshAt: "2026-08-07T08:00:00.000Z",
    createdByUserAccountId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-07T08:01:00.000Z",
    version: 1,
    ...overrides,
  };
}
