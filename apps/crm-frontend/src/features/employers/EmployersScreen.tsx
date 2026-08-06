import { IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  crmApi,
  type EmployersResponse,
  hasRepeatedNextCursor,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { DataTable, type DataTableColumn, PageHeader, StateMessage, StatusPill } from "@/shared/ui";
import "./employers.css";

type EmployerRow = EmployersResponse["items"][number];

export function EmployersScreen() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const employers = useInfiniteQuery({
    queryKey: ["crm", "employers", { search, statusFilter }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listEmployers({
        limit: 200,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const rows = employers.data?.pages.flatMap((page) => page.items) ?? [];
  const repeatedCursor = hasRepeatedNextCursor(employers.data?.pages ?? []);
  const hasVisibleData = rows.length > 0;
  const state = employers.isPending
    ? "loading"
    : employers.isError && !hasVisibleData
      ? employers.error instanceof ApiError && employers.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";
  const columns: readonly DataTableColumn<EmployerRow>[] = [
    { id: "name", label: "Работодатель", render: (row) => <strong>{row.name}</strong> },
    { id: "publicId", label: "Номер", render: (row) => row.publicId },
    { id: "type", label: "Тип", render: (row) => row.organizationType },
    { id: "tax", label: "ИНН", render: (row) => row.taxIdMask ?? "Не указан" },
    { id: "contacts", label: "Контакты", render: (row) => row.contactCount },
    { id: "referrals", label: "Открытые направления", render: (row) => row.openReferralCount },
    {
      id: "status",
      label: "Статус",
      render: (row) => <StatusPill status={row.status} label={row.status} />,
    },
  ];

  return (
    <div className="employers-screen">
      <PageHeader
        title="Работодатели"
        description="Показываются только компании, доступные в effective scope специалиста."
      />
      <div className="employers-toolbar">
        <label className="employers-search">
          <span className="crm-sr-only">Найти работодателя</span>
          <IconSearch aria-hidden size={18} />
          <input
            type="search"
            value={search}
            placeholder="Название или номер"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <label className="employers-select">
          <span>Статус</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value)}
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
            <option value="archived">Архивные</option>
          </select>
        </label>
      </div>
      <DataTable
        caption="Доступные работодатели"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        state={state}
      />
      {employers.hasNextPage ? (
        <div className="employers-pagination" aria-live="polite">
          <span>Загружено работодателей: {rows.length}</span>
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={repeatedCursor || employers.isFetchingNextPage}
            onClick={() => {
              if (!repeatedCursor) void employers.fetchNextPage();
            }}
          >
            {employers.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё работодателей"}
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
      {employers.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={employers.error.message}
          action={{ label: "Повторить", onPress: () => void employers.fetchNextPage() }}
        />
      ) : null}
      {employers.isError && state === "error" ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          onClick={() => void employers.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
    </div>
  );
}
