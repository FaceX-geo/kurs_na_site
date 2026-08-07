import { IconArrowsSort } from "@tabler/icons-react";
import type { KeyboardEvent, ReactNode } from "react";
import { StateMessage } from "./StateMessage";
import type { AsyncState } from "./types";

export type SortDirection = "asc" | "desc";

export interface DataTableSort {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  label: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  onOpenRow?: (row: T) => void;
  selectedId?: string | null;
  empty?: ReactNode;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  getRowLabel?: (row: T) => string;
  state?: AsyncState;
}

const STATE_COPY: Record<Exclude<AsyncState, "ready">, { title: string; message: string }> = {
  loading: { title: "Загрузка данных", message: "Сохраняем структуру таблицы до ответа сервера." },
  empty: { title: "Данных пока нет", message: "Измените фильтры или создайте первую запись." },
  error: {
    title: "Не удалось загрузить данные",
    message: "Повторите запрос из текущего контекста.",
  },
  validation: {
    title: "Проверьте параметры",
    message: "Часть условий запроса требует исправления.",
  },
  stale: {
    title: "Данные обновляются",
    message: "Изменения временно недоступны до сверки версии.",
  },
  denied: {
    title: "Недостаточно прав",
    message: "Скрытые записи и их количество не показываются.",
  },
  conflict: { title: "Версия изменилась", message: "Обновите данные перед следующим действием." },
  archived: {
    title: "Запись находится в архиве",
    message: "Доступен только разрешённый режим чтения.",
  },
};

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  onOpenRow,
  selectedId = null,
  empty,
  sort = null,
  onSortChange,
  getRowLabel,
  state = "ready",
}: DataTableProps<T>) {
  const openFromKeyboard = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!onOpenRow || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    onOpenRow(row);
  };

  const requestSort = (columnId: string) => {
    const direction = sort?.columnId === columnId && sort.direction === "asc" ? "desc" : "asc";
    onSortChange?.({ columnId, direction });
  };

  const effectiveState = state === "ready" && rows.length === 0 ? "empty" : state;

  return (
    <section className="crm-data-table" aria-busy={effectiveState === "loading"}>
      <div className="crm-data-table__scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const activeSort = sort?.columnId === column.id ? sort.direction : undefined;
                return (
                  <th
                    className={column.headerClassName}
                    scope="col"
                    aria-sort={
                      activeSort === "asc"
                        ? "ascending"
                        : activeSort === "desc"
                          ? "descending"
                          : undefined
                    }
                    key={column.id}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="crm-data-table__sort"
                        onClick={() => requestSort(column.id)}
                      >
                        {column.label}
                        <IconArrowsSort aria-hidden="true" size={16} stroke={1.8} />
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {effectiveState === "ready"
              ? rows.map((row) => {
                  const rowId = getRowId(row);
                  const selected = rowId === selectedId;
                  return (
                    <tr
                      className={selected ? "is-selected" : undefined}
                      aria-label={getRowLabel?.(row)}
                      aria-selected={selected}
                      tabIndex={onOpenRow ? 0 : undefined}
                      onClick={onOpenRow ? () => onOpenRow(row) : undefined}
                      onKeyDown={(event) => openFromKeyboard(event, row)}
                      key={rowId}
                    >
                      {columns.map((column) => (
                        <td
                          className={column.cellClassName}
                          data-label={column.label}
                          key={column.id}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>

      {effectiveState === "empty" && empty ? (
        <div className="crm-data-table__state">{empty}</div>
      ) : effectiveState !== "ready" ? (
        <div className="crm-data-table__state">
          <StateMessage
            state={effectiveState}
            title={STATE_COPY[effectiveState].title}
            message={STATE_COPY[effectiveState].message}
          />
        </div>
      ) : null}
    </section>
  );
}
