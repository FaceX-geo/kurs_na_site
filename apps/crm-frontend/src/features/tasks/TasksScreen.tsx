import {
  IconAlertTriangle,
  IconCalendar,
  IconInfoCircle,
  IconLayoutKanban,
  IconLink,
  IconList,
  IconX,
} from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import { crmApi, hasRepeatedNextCursor, nextCursorForPage, type TasksResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import {
  CursorPagination,
  DataTable,
  type DataTableColumn,
  KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  PageHeader,
  StateMessage,
  StatusPill,
  ViewSwitcher,
} from "@/shared/ui";
import "./tasks.css";

type TaskRow = TasksResponse["items"][number];
type TaskView = "list" | "kanban";

const TASK_COLUMNS: readonly KanbanColumn[] = [
  { id: "todo", title: "К работе", tone: "new" },
  { id: "in_progress", title: "В работе", tone: "work" },
  { id: "done", title: "Выполнено", tone: "done" },
];

const TASK_STATE_LABELS: Record<string, string> = {
  todo: "К работе",
  in_progress: "В работе",
  done: "Выполнено",
  cancelled: "Отменено",
};

const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

function taskStateLabel(value: string): string {
  return TASK_STATE_LABELS[value] ?? value.replaceAll("_", " ");
}

function taskPriorityLabel(value: string): string {
  return TASK_PRIORITY_LABELS[value] ?? value.replaceAll("_", " ");
}

export function TasksScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: TaskView = searchParams.get("view") === "kanban" ? "kanban" : "list";
  const stateFilter = searchParams.get("state") ?? "";
  const caseFilter = searchParams.get("case") ?? "";
  const referralFilter = searchParams.get("referral") ?? "";
  const responsibleFilter = searchParams.get("responsible") ?? "";
  const overdueOnly =
    searchParams.get("overdue") === "true" || searchParams.get("filter") === "overdue";
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(caseFilter || referralFilter || responsibleFilter),
  );
  const [selectedId, setSelectedId] = useState("");

  const tasks = useInfiniteQuery({
    queryKey: [
      "crm",
      "tasks",
      { stateFilter, overdueOnly, caseFilter, referralFilter, responsibleFilter },
    ],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listTasks({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(overdueOnly ? { overdue: true } : {}),
        ...(caseFilter ? { caseId: caseFilter } : {}),
        ...(referralFilter ? { referralId: referralFilter } : {}),
        ...(responsibleFilter ? { responsibleEmployeeProfileId: responsibleFilter } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });

  const loadedPages = tasks.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
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
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  const boardColumns = useMemo<readonly KanbanColumn[]>(() => {
    const known = new Set(TASK_COLUMNS.map((column) => column.id));
    const extra = Array.from(new Set(rows.map((row) => row.state)))
      .filter((taskState) => !known.has(taskState))
      .map((taskState) => ({
        id: taskState,
        title: taskStateLabel(taskState),
        tone: "review" as const,
      }));
    return [...TASK_COLUMNS, ...extra];
  }, [rows]);
  const cards = useMemo<readonly KanbanCard[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        columnId: row.state,
        title: row.title,
        subtitle: row.publicId,
        badge: <StatusPill status={row.priority} label={taskPriorityLabel(row.priority)} />,
        meta: [
          {
            label: "Срок",
            value: row.dueAt ? new Date(row.dueAt).toLocaleDateString("ru-RU") : "Без срока",
          },
          { label: "Связь", value: row.caseId ? "Заявка" : "Без заявки" },
        ],
      })),
    [rows],
  );

  const columns: readonly DataTableColumn<TaskRow>[] = [
    {
      id: "title",
      label: "Задача",
      render: (row) => (
        <span className="tasks-title-cell">
          <strong>{row.title}</strong>
          <small>{row.publicId}</small>
        </span>
      ),
    },
    {
      id: "state",
      label: "Статус",
      render: (row) => <StatusPill status={row.state} label={taskStateLabel(row.state)} />,
    },
    {
      id: "priority",
      label: "Приоритет",
      render: (row) => <StatusPill status={row.priority} label={taskPriorityLabel(row.priority)} />,
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
    {
      id: "case",
      label: "Заявка",
      render: (row) =>
        row.caseId ? (
          <button
            type="button"
            className="tasks-case-link"
            onClick={(event) => {
              event.stopPropagation();
              navigate(CRM_PATHS.case(row.caseId ?? ""));
            }}
          >
            <IconLink aria-hidden size={15} />
            Открыть
          </button>
        ) : (
          "Не связана"
        ),
    },
  ];

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    params.delete("filter");
    if (value) params.set(key, value);
    else params.delete(key);
    setCurrentPageIndex(0);
    setSelectedId("");
    setSearchParams(params, { replace: true });
  }

  function resetFilters() {
    const params = new URLSearchParams();
    params.set("view", view);
    setCurrentPageIndex(0);
    setSelectedId("");
    setSearchParams(params, { replace: true });
  }

  const activeFilterCount = [
    stateFilter,
    overdueOnly,
    caseFilter,
    referralFilter,
    responsibleFilter,
  ].filter(Boolean).length;

  return (
    <div className="tasks-screen">
      <PageHeader
        eyebrow="Рабочая очередь"
        title={overdueOnly ? "Просроченные задачи" : "Задачи CRM"}
        description="Фильтры выполняются сервером внутри effective scope. Доска задач пока только читает состояния: backend не публикует граф допустимых переходов."
      />

      <section className="tasks-filter-panel" aria-label="Представление и фильтры задач">
        <div className="tasks-toolbar">
          <ViewSwitcher
            value={view}
            options={[
              { value: "list", label: "Список", icon: <IconList aria-hidden size={17} /> },
              {
                value: "kanban",
                label: "Канбан",
                icon: <IconLayoutKanban aria-hidden size={17} />,
              },
            ]}
            onChange={(next) => setParam("view", next)}
          />
          <label className="tasks-filter-control">
            <span>Статус</span>
            <select
              value={stateFilter}
              onChange={(event) => setParam("state", event.currentTarget.value)}
            >
              <option value="">Все статусы</option>
              <option value="todo">К работе</option>
              <option value="in_progress">В работе</option>
              <option value="done">Выполнено</option>
            </select>
          </label>
          <button
            type="button"
            className={overdueOnly ? "tasks-filter-toggle is-active" : "tasks-filter-toggle"}
            aria-pressed={overdueOnly}
            onClick={() => setParam("overdue", overdueOnly ? "" : "true")}
          >
            <IconAlertTriangle aria-hidden size={17} />
            Только просроченные
          </button>
          <button
            type="button"
            className={advancedOpen ? "tasks-filter-toggle is-active" : "tasks-filter-toggle"}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            Ещё фильтры
          </button>
        </div>

        {advancedOpen ? (
          <div className="tasks-advanced-filters">
            <label className="tasks-filter-control">
              <span>ID заявки</span>
              <input
                value={caseFilter}
                onChange={(event) => setParam("case", event.currentTarget.value.trim())}
              />
            </label>
            <label className="tasks-filter-control">
              <span>ID направления</span>
              <input
                value={referralFilter}
                onChange={(event) => setParam("referral", event.currentTarget.value.trim())}
              />
            </label>
            <label className="tasks-filter-control">
              <span>ID ответственного</span>
              <input
                value={responsibleFilter}
                onChange={(event) => setParam("responsible", event.currentTarget.value.trim())}
              />
            </label>
          </div>
        ) : null}

        {activeFilterCount > 0 ? (
          <div className="tasks-active-filters" role="status">
            <span>Активно фильтров: {activeFilterCount}</span>
            <button type="button" onClick={resetFilters}>
              <IconX aria-hidden size={16} />
              Сбросить
            </button>
          </div>
        ) : null}
      </section>

      {view === "kanban" ? (
        <>
          <div className="tasks-contract-note" role="note">
            <IconInfoCircle aria-hidden size={18} />
            Перетаскивание задач выключено до публикации backend-графа переходов. Открытие карточки
            и список доступны полностью.
          </div>
          {state === "ready" ? (
            <KanbanBoard
              ariaLabel="Задачи CRM"
              columns={boardColumns}
              cards={cards}
              selectedId={selected?.id ?? null}
              onOpenCard={(card) => setSelectedId(card.id)}
            />
          ) : (
            <StateMessage state={state} title="Задачи недоступны" />
          )}
        </>
      ) : (
        <div className="tasks-workspace">
          <DataTable
            caption="Разрешённые CRM-задачи"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            getRowLabel={(row) => row.title}
            onOpenRow={(row) => setSelectedId(row.id)}
            selectedId={selected?.id ?? null}
            state={state}
          />
          {selected ? (
            <TaskInspector
              task={selected}
              onOpenCase={() => selected.caseId && navigate(CRM_PATHS.case(selected.caseId))}
            />
          ) : null}
        </div>
      )}

      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel="Пагинация задач"
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(tasks.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={rows.length}
          isFetchingNextPage={tasks.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={setCurrentPageIndex}
          onFetchNextPage={async () => {
            if (repeatedCursor) return;
            const before = loadedPages.length;
            const result = await tasks.fetchNextPage();
            const after = result.data?.pages.length ?? before;
            if (after > before) setCurrentPageIndex(after - 1);
          }}
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

function TaskInspector({ task, onOpenCase }: { task: TaskRow; onOpenCase: () => void }) {
  return (
    <aside className="tasks-inspector" aria-labelledby="tasks-inspector-title">
      <p>{task.publicId}</p>
      <h2 id="tasks-inspector-title">{task.title}</h2>
      <div className="tasks-inspector__status">
        <StatusPill status={task.state} label={taskStateLabel(task.state)} />
        <StatusPill status={task.priority} label={taskPriorityLabel(task.priority)} />
      </div>
      {task.description ? <p>{task.description}</p> : <p>Описание не заполнено.</p>}
      <dl>
        <div>
          <dt>Срок</dt>
          <dd>{task.dueAt ? new Date(task.dueAt).toLocaleString("ru-RU") : "Без срока"}</dd>
        </div>
        <div>
          <dt>Часовой пояс</dt>
          <dd>{task.timezone}</dd>
        </div>
        <div>
          <dt>Версия</dt>
          <dd>{task.version}</dd>
        </div>
      </dl>
      {task.caseId ? (
        <button type="button" className="crm-button crm-button--quiet" onClick={onOpenCase}>
          <IconCalendar aria-hidden size={17} />
          Открыть связанную заявку
        </button>
      ) : null}
    </aside>
  );
}
