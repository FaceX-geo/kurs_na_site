import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface ActiveFilterDescriptor {
  id: string;
  label: string;
  valueLabel: string;
  removable?: boolean;
}

export interface FilterBarProps {
  children: ReactNode;
  activeFilters: readonly ActiveFilterDescriptor[];
  ariaLabel?: string;
  resultSummary?: string;
  pending?: boolean;
  onRemoveFilter?: (filterId: string) => void;
  onClearAll?: () => void;
}

export function FilterBar({
  children,
  activeFilters,
  ariaLabel = "Фильтры списка",
  resultSummary,
  pending = false,
  onRemoveFilter,
  onClearAll,
}: FilterBarProps) {
  return (
    <section className="crm-filter-bar" aria-label={ariaLabel} aria-busy={pending}>
      <div className="crm-filter-bar__controls">{children}</div>

      <div className="crm-filter-bar__summary" aria-live="polite" aria-atomic="true">
        <span>
          {activeFilters.length > 0
            ? `Активные фильтры: ${activeFilters.length}.`
            : "Фильтры не применены."}
        </span>
        {resultSummary ? <span>{resultSummary}</span> : null}
        {pending ? <span>Обновляем результаты…</span> : null}
      </div>

      {activeFilters.length > 0 ? (
        <div className="crm-filter-bar__active">
          <ul aria-label="Применённые фильтры">
            {activeFilters.map((filter) => {
              const removable = filter.removable !== false && onRemoveFilter !== undefined;
              return (
                <li key={filter.id}>
                  <span>
                    <strong>{filter.label}:</strong> {filter.valueLabel}
                  </span>
                  {removable ? (
                    <button
                      type="button"
                      aria-label={`Удалить фильтр «${filter.label}: ${filter.valueLabel}»`}
                      disabled={pending}
                      onClick={() => onRemoveFilter(filter.id)}
                    >
                      <IconX aria-hidden="true" size={16} stroke={2} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {onClearAll ? (
            <button
              type="button"
              className="crm-filter-bar__clear"
              disabled={pending}
              onClick={onClearAll}
            >
              Сбросить все
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
