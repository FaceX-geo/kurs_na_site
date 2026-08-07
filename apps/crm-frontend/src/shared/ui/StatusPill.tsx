import type { ButtonHTMLAttributes } from "react";

export type StatusTone = "neutral" | "work" | "success" | "attention" | "danger" | "ai";

export interface StatusPillProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> {
  status: string;
  label?: string;
  tone?: StatusTone;
  interactive?: boolean;
  onPress?: (status: string) => void;
}

export function StatusPill({
  status,
  label = status,
  tone = "neutral",
  interactive = false,
  onPress,
  disabled,
  ...buttonProps
}: StatusPillProps) {
  const className = `crm-status-pill crm-status-pill--${tone}`;

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => onPress?.(status)}
        {...buttonProps}
      >
        {label}
      </button>
    );
  }

  return (
    <span className={className} role="status" data-status={status}>
      {label}
    </span>
  );
}
