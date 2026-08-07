import { IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  crmApi,
  type EmployersResponse,
  hasRepeatedNextCursor,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import {
  type ActiveFilterDescriptor,
  CursorPagination,
  DataTable,
  type DataTableColumn,
  FilterBar,
  PageHeader,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import "./employers.css";

type EmployerRow = EmployersResponse["items"][number];

const EMPLOYER_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  needs_review: "Нужна проверка",
};

export function EmployersScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const statusFilter = searchParams.get("status") ?? "";
  const [searchDraft, setSearchDraft] = useState(search);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => setSearchDraft(search), [search]);

  useEffect(() => {
    const normalized = searchDraft.trim();
    if (normalized === search) return undefined;
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (normalized) next.set("search", normalized);
      else next.delete("search");
      setCurrentPageIndex(0);
      setSearchParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search, searchDraft, searchParams, setSearchParams]);

  const employers = useInfiniteQuery({
    queryKey: ["crm", "employers", { search, statusFilter }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listEmployers({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const loadedPages = employers.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
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
  const activeFilters: ActiveFilterDescriptor[] = [
    ...(search ? [{ id: "search", label: "Поиск", valueLabel: search }] : []),
    ...(statusFilter
      ? [
          {
            id: "status",
            label: "Статус",
            valueLabel: EMPLOYER_STATUS_LABELS[statusFilter] ?? statusFilter,
          },
        ]
      : []),
  ];

  const setStatus = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    setCurrentPageIndex(0);
    setSearchParams(next, { replace: true });
  };

  const removeFilter = (filterId: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(filterId);
    setCurrentPageIndex(0);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("search");
    next.delete("status");
    setCurrentPageIndex(0);
    setSearchParams(next, { replace: true });
  };

  const fetchNextAndAdvance = async () => {
    if (repeatedCursor) return;
    const before = loadedPages.length;
    const result = await employers.fetchNextPage();
    const after = result.data?.pages.length ?? before;
    if (after > before) setCurrentPageIndex(after - 1);
  };

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
      render: (row) => (
        <StatusPill status={row.status} label={EMPLOYER_STATUS_LABELS[row.status] ?? row.status} />
      ),
    },
  ];

  return (
    <div className="employers-screen">
      <PageHeader
        title="Работодатели"
        description="Показываются только компании, доступные в effective scope специалиста."
      />
      <FilterBar
        ariaLabel="Фильтры работодателей"
        activeFilters={activeFilters}
        resultSummary={`На текущей странице: ${rows.length}. Загружено записей: ${loadedItemCount}.`}
        pending={employers.isFetching || searchDraft.trim() !== search}
        onRemoveFilter={removeFilter}
        onClearAll={clearFilters}
      >
        <label className="employers-search">
          <span className="crm-sr-only">Найти работодателя</span>
          <IconSearch aria-hidden size={18} />
          <input
            type="search"
            value={searchDraft}
            placeholder="Название или номер"
            onChange={(event) => setSearchDraft(event.currentTarget.value)}
          />
        </label>
        <label className="employers-select">
          <span>Статус</span>
          <select value={statusFilter} onChange={(event) => setStatus(event.currentTarget.value)}>
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="needs_review">Нужна проверка</option>
          </select>
        </label>
      </FilterBar>
      <DataTable
        caption="Доступные работодатели"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        state={state}
      />
      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel="Пагинация работодателей"
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(employers.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={rows.length}
          isFetchingNextPage={employers.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={setCurrentPageIndex}
          onFetchNextPage={fetchNextAndAdvance}
        />
      ) : null}
      {employers.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={employers.error.message}
          action={{ label: "Повторить", onPress: () => void fetchNextAndAdvance() }}
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
