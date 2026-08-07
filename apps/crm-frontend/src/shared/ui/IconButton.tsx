import type { ButtonHTMLAttributes } from "react";
import type { UiIcon } from "./types";

export type IconButtonTone = "ghost" | "primary" | "danger" | "sidebar";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> {
  icon: UiIcon;
  label: string;
  tone?: IconButtonTone;
  badge?: string | number | null;
  active?: boolean;
  onPress?: (event: { source: "keyboard" | "pointer" }) => void;
}

export function IconButton({
  icon: Icon,
  label,
  tone = "ghost",
  badge = null,
  active,
  className = "",
  onPress,
  ...buttonProps
}: IconButtonProps) {
  const accessibleLabel = badge === null ? label : `${label}, ${badge}`;

  return (
    <button
      type="button"
      className={`crm-icon-button crm-icon-button--${tone}${active ? " is-active" : ""} ${className}`.trim()}
      aria-label={accessibleLabel}
      aria-pressed={active}
      data-tooltip={label}
      onClick={(event) => onPress?.({ source: event.detail === 0 ? "keyboard" : "pointer" })}
      {...buttonProps}
    >
      <Icon aria-hidden size={20} stroke={1.8} />
      {badge === null ? null : (
        <span className="crm-icon-button__badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}
