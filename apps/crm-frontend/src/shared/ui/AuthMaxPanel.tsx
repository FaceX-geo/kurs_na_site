import type { FormEvent, ReactNode } from "react";

export type AuthMaxMode = "login" | "verify" | "recovery" | "enroll";
export type AuthMaxStatus =
  | "idle"
  | "incomplete"
  | "pending"
  | "cooldown"
  | "expired"
  | "exhausted"
  | "mismatch"
  | "unavailable"
  | "locked"
  | "enrollment-pending";

export interface AuthMaxPanelProps {
  mode: AuthMaxMode;
  status: AuthMaxStatus;
  title: string;
  description: string;
  children: ReactNode;
  onSubmit: () => void;
  submitLabel: string;
  pending?: boolean;
  statusMessage?: string;
  secondaryAction?: ReactNode;
  developmentStub?: boolean;
  onDevelopmentContinue?: () => void;
}

export function AuthMaxPanel({
  mode,
  status,
  title,
  description,
  children,
  onSubmit,
  submitLabel,
  pending = false,
  statusMessage,
  secondaryAction,
  developmentStub = false,
  onDevelopmentContinue,
}: AuthMaxPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <main className="crm-auth" data-mode={mode}>
      <section className="crm-auth-panel" aria-labelledby="crm-auth-title">
        <header>
          <p className="crm-auth-panel__product">Курс на Север · CRM</p>
          <h1 id="crm-auth-title">{title}</h1>
          <p>{description}</p>
        </header>
        {developmentStub ? (
          <div className="crm-auth-panel__stub" role="note">
            <strong>Тестовый режим</strong>
            <p>Продолжение ниже не является подтверждением через MAX и недоступно в production.</p>
          </div>
        ) : null}
        {statusMessage ? (
          <p
            className={`crm-auth-panel__status crm-auth-panel__status--${status}`}
            role={status === "mismatch" || status === "locked" ? "alert" : "status"}
          >
            {statusMessage}
          </p>
        ) : null}
        <form onSubmit={handleSubmit} aria-busy={pending}>
          {children}
          <button type="submit" className="crm-button crm-button--primary" disabled={pending}>
            {pending ? "Проверяем…" : submitLabel}
          </button>
        </form>
        {secondaryAction ? (
          <div className="crm-auth-panel__secondary">{secondaryAction}</div>
        ) : null}
        {developmentStub && onDevelopmentContinue ? (
          <button
            type="button"
            className="crm-button crm-button--test"
            onClick={onDevelopmentContinue}
          >
            Продолжить с тестовой сессией
          </button>
        ) : null}
      </section>
    </main>
  );
}
