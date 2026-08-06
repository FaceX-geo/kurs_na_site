import { IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
  type PeopleResponse,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { DataTable, type DataTableColumn, PageHeader, StateMessage, StatusPill } from "@/shared/ui";
import "./people.css";

type PersonRow = PeopleResponse["items"][number];

export function PeopleRegistryScreen() {
  const [search, setSearch] = useState("");
  const [quality, setQuality] = useState("");
  const people = useInfiniteQuery({
    queryKey: ["crm", "people", { search, quality }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listPeople({
        limit: 200,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(quality ? { dataQualityState: quality } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const rows = people.data?.pages.flatMap((page) => page.items) ?? [];
  const repeatedCursor = hasRepeatedNextCursor(people.data?.pages ?? []);
  const hasVisibleData = rows.length > 0;
  const state = people.isPending
    ? "loading"
    : people.isError && !hasVisibleData
      ? people.error instanceof ApiError && people.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";
  const columns: readonly DataTableColumn<PersonRow>[] = [
    { id: "name", label: "Участник", render: (row) => <strong>{row.displayName}</strong> },
    {
      id: "contacts",
      label: "Контакты",
      render: (row) => row.contactMask.email ?? row.contactMask.phone ?? "Скрыты",
    },
    {
      id: "profile",
      label: "Профиль",
      render: (row) => <StatusPill status={row.profileState} label={row.profileState} />,
    },
    {
      id: "quality",
      label: "Качество данных",
      render: (row) => <StatusPill status={row.dataQualityState} label={row.dataQualityState} />,
    },
    { id: "cases", label: "Активные заявки", render: (row) => row.activeCaseCount },
    {
      id: "updated",
      label: "Обновлено",
      render: (row) => new Date(row.updatedAt).toLocaleDateString("ru-RU"),
    },
  ];

  return (
    <div className="people-screen">
      <PageHeader
        title="Участники назначенных процессов"
        description="Backend возвращает только разрешённую проекцию; скрытые записи и totals не восстанавливаются в браузере."
      />
      <div className="people-toolbar">
        <label className="people-search">
          <span className="sr-only">Найти участника</span>
          <IconSearch aria-hidden size={18} />
          <input
            type="search"
            value={search}
            placeholder="Имя или контакт"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className="sr-only">Качество данных</span>
          <select value={quality} onChange={(event) => setQuality(event.currentTarget.value)}>
            <option value="">Любое качество данных</option>
            <option value="verified">Проверено</option>
            <option value="incomplete">Неполные данные</option>
            <option value="conflict">Конфликт</option>
          </select>
        </label>
      </div>
      <DataTable
        caption="Разрешённые участники CRM"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        state={state}
      />
      {people.hasNextPage ? (
        <div className="people-pagination" aria-live="polite">
          <span>Загружено записей: {rows.length}</span>
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={repeatedCursor || people.isFetchingNextPage}
            onClick={() => {
              if (!repeatedCursor) void people.fetchNextPage();
            }}
          >
            {people.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё участников"}
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
      {people.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={people.error.message}
          action={{ label: "Повторить", onPress: () => void people.fetchNextPage() }}
        />
      ) : null}
      {people.isError && state === "error" ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          onClick={() => void people.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}
