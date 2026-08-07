import type { ReactNode } from "react";

export interface ViewSwitcherOption<TValue extends string = string> {
  value: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ViewSwitcherProps<TValue extends string = string> {
  value: TValue;
  options: readonly ViewSwitcherOption<TValue>[];
  onChange: (value: TValue) => void;
  ariaLabel?: string;
}

export function ViewSwitcher<TValue extends string = string>({
  value,
  options,
  onChange,
  ariaLabel = "Представление",
}: ViewSwitcherProps<TValue>) {
  return (
    <fieldset className="crm-view-switcher">
      <legend className="crm-sr-only">{ariaLabel}</legend>
      {options.map((option) => (
        <button
          type="button"
          className={value === option.value ? "is-active" : undefined}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          key={option.value}
        >
          {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
          <span>{option.label}</span>
        </button>
      ))}
    </fieldset>
  );
}
