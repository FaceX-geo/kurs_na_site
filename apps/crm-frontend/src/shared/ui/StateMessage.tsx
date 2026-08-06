import type { ReactNode } from "react";
import type { AsyncState } from "./types";

export interface StateMessageAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface StateMessageProps {
  state: Exclude<AsyncState, "ready">;
  title: string;
  message?: string;
  action?: StateMessageAction;
  icon?: ReactNode;
  compact?: boolean;
}

const ASSERTIVE_STATES = new Set<AsyncState>(["error", "validation", "conflict"]);

export function StateMessage({
  state,
  title,
  message,
  action,
  icon,
  compact = false,
}: StateMessageProps) {
  const assertive = ASSERTIVE_STATES.has(state);

  return (
    <section
      className={`crm-state-message crm-state-message--${state}${compact ? " is-compact" : ""}`}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {icon ? <div className="crm-state-message__icon">{icon}</div> : null}
      <div className="crm-state-message__copy">
        <h2>{title}</h2>
        {message ? <p>{message}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          disabled={action.disabled}
          onClick={action.onPress}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
