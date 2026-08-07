import { IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
  type PeopleResponse,
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
import "./people.css";

type PersonRow = PeopleResponse["items"][number];

const PROFILE_STATE_LABELS: Record<string, string> = {
  active: "Активный",
  inactive: "Неактивный",
  merged: "Объединён",
};

const DATA_QUALITY_LABELS: Record<string, string> = {
  needs_review: "Нужна проверка",
  verified: "Проверено",
};

const PROGRAM_TYPE_LABELS: Record<string, string> = {
  relocation: "Переезд",
  student: "Студенты",
};

export function PeopleRegistryScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const profileState = searchParams.get("profile") ?? "";
  const dataQualityState = searchParams.get("quality") ?? "";
  const programType = searchParams.get("program") ?? "";
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

  const people = useInfiniteQuery({
    queryKey: ["crm", "people", { search, profileState, dataQualityState, programType }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listPeople({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(profileState ? { profileState } : {}),
        ...(dataQualityState ? { dataQualityState } : {}),
        ...(programType ? { programType } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const loadedPages = people.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
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
  const activeFilters: ActiveFilterDescriptor[] = [
    ...(search ? [{ id: "search", label: "Поиск", valueLabel: search }] : []),
    ...(profileState
      ? [
          {
            id: "profile",
            label: "Состояние профиля",
            valueLabel: PROFILE_STATE_LABELS[profileState] ?? profileState,
          },
        ]
      : []),
    ...(dataQualityState
      ? [
          {
            id: "quality",
            label: "Качество данных",
            valueLabel: DATA_QUALITY_LABELS[dataQualityState] ?? dataQualityState,
          },
        ]
      : []),
    ...(programType
      ? [
          {
            id: "program",
            label: "Программа",
            valueLabel: PROGRAM_TYPE_LABELS[programType] ?? programType,
          },
        ]
      : []),
  ];

  const setFilter = (key: "profile" | "quality" | "program", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
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
    for (const key of ["search", "profile", "quality", "program"]) next.delete(key);
    setCurrentPageIndex(0);
    setSearchParams(next, { replace: true });
  };

  const fetchNextAndAdvance = async () => {
    if (repeatedCursor) return;
    const before = loadedPages.length;
    const result = await people.fetchNextPage();
    const after = result.data?.pages.length ?? before;
    if (after > before) setCurrentPageIndex(after - 1);
  };

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
      render: (row) => (
        <StatusPill
          status={row.profileState}
          label={PROFILE_STATE_LABELS[row.profileState] ?? row.profileState}
        />
      ),
    },
    {
      id: "quality",
      label: "Качество данных",
      render: (row) => (
        <StatusPill
          status={row.dataQualityState}
          label={DATA_QUALITY_LABELS[row.dataQualityState] ?? row.dataQualityState}
        />
      ),
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
      <FilterBar
        ariaLabel="Фильтры участников"
        activeFilters={activeFilters}
        resultSummary={`На текущей странице: ${rows.length}. Загружено записей: ${loadedItemCount}.`}
        pending={people.isFetching || searchDraft.trim() !== search}
        onRemoveFilter={removeFilter}
        onClearAll={clearFilters}
      >
        <label className="people-search">
          <span className="crm-sr-only">Найти участника</span>
          <IconSearch aria-hidden size={18} />
          <input
            type="search"
            value={searchDraft}
            placeholder="Имя или контакт"
            onChange={(event) => setSearchDraft(event.currentTarget.value)}
          />
        </label>
        <label className="people-filter-field">
          <span>Состояние профиля</span>
          <select
            value={profileState}
            onChange={(event) => setFilter("profile", event.currentTarget.value)}
          >
            <option value="">Все состояния</option>
            <option value="active">Активный</option>
            <option value="inactive">Неактивный</option>
            <option value="merged">Объединён</option>
          </select>
        </label>
        <label className="people-filter-field">
          <span>Качество данных</span>
          <select
            value={dataQualityState}
            onChange={(event) => setFilter("quality", event.currentTarget.value)}
          >
            <option value="">Любое качество</option>
            <option value="verified">Проверено</option>
            <option value="needs_review">Нужна проверка</option>
          </select>
        </label>
        <label className="people-filter-field">
          <span>Программа</span>
          <select
            value={programType}
            onChange={(event) => setFilter("program", event.currentTarget.value)}
          >
            <option value="">Все программы</option>
            <option value="relocation">Переезд</option>
            <option value="student">Студенты</option>
          </select>
        </label>
      </FilterBar>
      <DataTable
        caption="Разрешённые участники CRM"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        state={state}
      />
      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel="Пагинация участников"
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(people.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={rows.length}
          isFetchingNextPage={people.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={setCurrentPageIndex}
          onFetchNextPage={fetchNextAndAdvance}
        />
      ) : null}
      {people.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={people.error.message}
          action={{ label: "Повторить", onPress: () => void fetchNextAndAdvance() }}
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
