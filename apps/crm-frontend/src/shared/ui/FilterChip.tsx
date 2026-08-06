import { IconX } from "@tabler/icons-react";
import type { KeyboardEvent } from "react";

export type FilterChipVariant = "single" | "multi" | "removable";

export interface FilterChipProps {
  label: string;
  value: string;
  selected: boolean;
  count?: number | null;
  disabled?: boolean;
  variant?: FilterChipVariant;
  onToggle?: (event: { value: string; selected: boolean }) => void;
  onRemove?: (event: { value: string }) => void;
}

export function FilterChip({
  label,
  value,
  selected,
  count = null,
  disabled = false,
  variant = "single",
  onToggle,
  onRemove,
}: FilterChipProps) {
  const handleDelete = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Delete" && variant === "removable" && onRemove) {
      event.preventDefault();
      onRemove({ value });
    }
  };

  const toggle = (
    <button
      type="button"
      className={`crm-filter-chip__toggle${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle?.({ value, selected: !selected })}
      onKeyDown={handleDelete}
    >
      <span>{label}</span>
      {count === null ? null : <span className="crm-filter-chip__count">{count}</span>}
    </button>
  );

  if (variant !== "removable") {
    return <span className="crm-filter-chip">{toggle}</span>;
  }

  return (
    <span className="crm-filter-chip crm-filter-chip--removable">
      {toggle}
      <button
        type="button"
        className="crm-filter-chip__remove"
        aria-label={`Удалить фильтр «${label}»`}
        disabled={disabled}
        onClick={() => onRemove?.({ value })}
      >
        <IconX aria-hidden="true" size={16} stroke={2} />
      </button>
    </span>
  );
}
