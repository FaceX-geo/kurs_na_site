import { IconAlertTriangle } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ActivitiesResponse,
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import {
  CursorPagination,
  DataTable,
  type DataTableColumn,
  PageHeader,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import "./communications.css";

type ActivityRow = ActivitiesResponse["items"][number];

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CommunicationsScreen() {
  const [direction, setDirection] = useState("");
  const [activityType, setActivityType] = useState("");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const activities = useInfiniteQuery({
    queryKey: ["crm", "activities", direction, activityType],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listActivities({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(direction ? { direction } : {}),
        ...(activityType ? { activityType } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const loadedPages = activities.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
  const hasVisibleData = rows.length > 0;
  const columns: readonly DataTableColumn<ActivityRow>[] = [
    {
      id: "occurredAt",
      label: "Время",
      render: (row) => <time dateTime={row.occurredAt}>{formatTimestamp(row.occurredAt)}</time>,
    },
    {
      id: "activityType",
      label: "Тип",
      render: (row) => <strong>{row.activityType}</strong>,
    },
    { id: "direction", label: "Направление", render: (row) => row.direction ?? "Не указано" },
    {
      id: "content",
      label: "Содержание",
      render: (row) => (
        <span>
          {row.subject ?? "Без темы"}
          {row.bodyPreview ? <small>{row.bodyPreview}</small> : null}
        </span>
      ),
    },
    {
      id: "deliveryState",
      label: "Состояние",
      render: (row) =>
        row.deliveryState ? (
          <StatusPill status={row.deliveryState} label={row.deliveryState} tone="neutral" />
        ) : (
          "Не предоставлено"
        ),
    },
    {
      id: "context",
      label: "Контекст",
      render: (row) =>
        row.caseId ?? row.personId ?? row.employerId ?? row.employerReferralId ?? "—",
    },
  ];
  const state = activities.isPending
    ? "loading"
    : activities.isError && !hasVisibleData
      ? activities.error instanceof ApiError && activities.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";

  const fetchNextAndAdvance = async () => {
    if (repeatedCursor) return;
    const before = loadedPages.length;
    const result = await activities.fetchNextPage();
    const after = result.data?.pages.length ?? before;
    if (after > before) setCurrentPageIndex(after - 1);
  };

  return (
    <div className="communications-screen">
      <PageHeader
        title="Коммуникации и активности"
        description="Read-only журнал действий из backend в пределах эффективного scope специалиста."
      />

      <StateMessage
        state="stale"
        icon={<IconAlertTriangle aria-hidden size={24} />}
        title="Создание сообщений временно закрыто"
        message="Текущий контракт не даёт безопасно восстановить список черновиков и provider outcome после перезагрузки. UI показывает только ListCrmActivities и не создаёт локальные сообщения или ложные квитанции доставки."
      />

      <section className="communications-list__filters" aria-label="Фильтры журнала">
        <label>
          <span>Тип активности</span>
          <input
            type="search"
            value={activityType}
            placeholder="Например, communication"
            onChange={(event) => {
              setCurrentPageIndex(0);
              setActivityType(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          <span>Направление</span>
          <select
            value={direction}
            onChange={(event) => {
              setCurrentPageIndex(0);
              setDirection(event.currentTarget.value);
            }}
          >
            <option value="">Все направления</option>
            <option value="inbound">Входящие</option>
            <option value="outbound">Исходящие</option>
            <option value="internal">Внутренние</option>
          </select>
        </label>
      </section>

      <DataTable
        caption="Журнал коммуникаций и активностей"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.subject ?? row.activityType}
        state={state}
      />

      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel="Пагинация коммуникаций и активностей"
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(activities.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={rows.length}
          isFetchingNextPage={activities.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={setCurrentPageIndex}
          onFetchNextPage={fetchNextAndAdvance}
        />
      ) : null}

      {activities.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={activities.error.message}
          action={{ label: "Повторить", onPress: () => void fetchNextAndAdvance() }}
        />
      ) : null}

      {activities.isError && state === "error" ? (
        <button
          className="crm-button crm-button--quiet"
          type="button"
          onClick={() => void activities.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}
