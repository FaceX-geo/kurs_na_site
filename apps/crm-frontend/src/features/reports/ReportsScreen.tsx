import { useQuery } from "@tanstack/react-query";
import { crmApi, type ReportRunsResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { DataTable, type DataTableColumn, PageHeader, StatusPill } from "@/shared/ui";
import "./reports.css";

type ReportRun = ReportRunsResponse["items"][number];

const REPORT_LABEL: Record<ReportRun["reportCode"], string> = {
  "pipeline.summary": "Воронки",
  "workload.summary": "Нагрузка специалистов",
  "referrals.outcomes": "Результаты направлений",
  "applications.sources": "Источники заявок",
  "employers.activity": "Активность работодателей",
  "relocation.results": "Результаты переезда",
  "data_quality.summary": "Качество данных",
};

export function ReportsScreen() {
  const reports = useQuery({
    queryKey: ["crm", "report-runs"],
    queryFn: () => crmApi.listReportRuns(),
  });
  const rows = reports.data?.items ?? [];
  const state = reports.isPending
    ? "loading"
    : reports.isError
      ? reports.error instanceof ApiError && reports.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";
  const columns: readonly DataTableColumn<ReportRun>[] = [
    {
      id: "report",
      label: "Отчёт",
      render: (row) => <strong>{REPORT_LABEL[row.reportCode]}</strong>,
    },
    { id: "publicId", label: "Номер", render: (row) => row.publicId },
    { id: "formula", label: "Формула", render: (row) => row.formulaVersion },
    { id: "scope", label: "Scope", render: (row) => row.scopeVisibility },
    {
      id: "state",
      label: "Статус",
      render: (row) => <StatusPill status={row.state} label={row.state} />,
    },
    { id: "excluded", label: "Исключено записей", render: (row) => row.excludedRecords },
    {
      id: "fresh",
      label: "Актуальность",
      render: (row) => new Date(row.dataFreshAt).toLocaleString("ru-RU"),
    },
  ];

  return (
    <div className="reports-screen">
      <PageHeader
        title="Проверяемые отчёты"
        description="Каждый результат содержит server-side scope, версию формулы и дату актуальности."
      />
      <DataTable
        caption="Запуски отчётов"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => `${REPORT_LABEL[row.reportCode]} ${row.publicId}`}
        state={state}
      />
      {reports.isError && state === "error" ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          onClick={() => void reports.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}
