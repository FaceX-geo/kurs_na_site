import { IconAlertTriangle, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { crmApi, hasRepeatedNextCursor, nextCursorForPage, type TasksResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { DataTable, type DataTableColumn, PageHeader, StateMessage, StatusPill } from "@/shared/ui";
import "./tasks.css";

type TaskRow = TasksResponse["items"][number];

export function TasksScreen() {
  const [searchParams] = useSearchParams();
  const [stateFilter, setStateFilter] = useState("");
  const overdueOnly = searchParams.get("filter") === "overdue";
  const tasks = useInfiniteQuery({
    queryKey: ["crm", "tasks", { stateFilter, overdueOnly }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listTasks({
        limit: 200,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(overdueOnly ? { overdue: true } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const rows = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  const repeatedCursor = hasRepeatedNextCursor(tasks.data?.pages ?? []);
  const hasVisibleData = rows.length > 0;
  const state = tasks.isPending
    ? "loading"
    : tasks.isError && !hasVisibleData
      ? tasks.error instanceof ApiError && tasks.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";
  const columns: readonly DataTableColumn<TaskRow>[] = [
    { id: "title", label: "Задача", render: (row) => <strong>{row.title}</strong> },
    {
      id: "state",
      label: "Статус",
      render: (row) => <StatusPill status={row.state} label={row.state} />,
    },
    {
      id: "priority",
      label: "Приоритет",
      render: (row) => <StatusPill status={row.priority} label={row.priority} />,
    },
    {
      id: "due",
      label: "Срок",
      render: (row) => (
        <span className={row.isOverdue ? "tasks-due is-overdue" : "tasks-due"}>
          {row.isOverdue ? <IconAlertTriangle aria-hidden size={16} /> : null}
          {row.dueAt ? new Date(row.dueAt).toLocaleString("ru-RU") : "Без срока"}
        </span>
      ),
    },
    { id: "case", label: "Заявка", render: (row) => row.caseId ?? "Не связана" },
  ];

  return (
    <div className="tasks-screen">
      <PageHeader
        title={overdueOnly ? "Просроченные задачи" : "Мои задачи"}
        description="Ответственный и effective scope определяются backend-сессией. Клиент не запрашивает задачи других специалистов."
      />
      <div className="tasks-toolbar">
        <span className="tasks-search">
          <IconSearch aria-hidden size={18} />
          Серверные фильтры
        </span>
        <label className="tasks-state-filter">
          <span className="sr-only">Статус задачи</span>
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.currentTarget.value)}
          >
            <option value="">Все статусы</option>
            <option value="todo">К работе</option>
            <option value="in_progress">В работе</option>
            <option value="done">Выполнено</option>
          </select>
        </label>
      </div>
      <DataTable
        caption="Разрешённые CRM-задачи"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.title}
        state={state}
      />
      {tasks.hasNextPage ? (
        <div className="tasks-pagination" aria-live="polite">
          <span>Загружено задач: {rows.length}</span>
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={repeatedCursor || tasks.isFetchingNextPage}
            onClick={() => {
              if (!repeatedCursor) void tasks.fetchNextPage();
            }}
          >
            {tasks.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё задачи"}
          </button>
        </div>
      ) : null}
      {repeatedCursor ? (
        <StateMessage
          state="stale"
          title="Пагинация остановлена безопасно"
          message="Backend повторил cursor. Frontend не запрашивает ту же страницу повторно."
        />
      ) : null}
      {tasks.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={tasks.error.message}
          action={{ label: "Повторить", onPress: () => void tasks.fetchNextPage() }}
        />
      ) : null}
      {tasks.isError && state === "error" ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          onClick={() => void tasks.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}
