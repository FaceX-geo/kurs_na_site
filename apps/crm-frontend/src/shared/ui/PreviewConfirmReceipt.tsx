import { type ReactNode, useId } from "react";
import type { OperationEvidence } from "./types";

export type OperationPhase = "draft" | "preview" | "confirming" | "executing" | "receipt";

export interface PreviewItem {
  label: string;
  before?: ReactNode;
  after: ReactNode;
  tone?: "neutral" | "attention" | "danger";
}

export interface OperationReceipt {
  title: string;
  message: string;
  outcome: "complete" | "partial" | "failed";
  evidence: OperationEvidence;
  items?: readonly { id: string; label: string; outcome: string; retryable?: boolean }[];
}

export interface PreviewConfirmReceiptProps {
  phase: OperationPhase;
  title: string;
  description?: string;
  operationId: string;
  previewItems?: readonly PreviewItem[];
  receipt?: OperationReceipt | null;
  confirmLabel?: string;
  pending?: boolean;
  onRequestPreview?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  onOpenReceiptTarget?: () => void;
  children?: ReactNode;
}

export function PreviewConfirmReceipt({
  phase,
  title,
  description,
  operationId,
  previewItems = [],
  receipt = null,
  confirmLabel = "Подтвердить",
  pending = false,
  onRequestPreview,
  onConfirm,
  onCancel,
  onOpenReceiptTarget,
  children,
}: PreviewConfirmReceiptProps) {
  const titleId = useId();

  if (phase === "receipt" && receipt) {
    return (
      <section
        className={`crm-operation-receipt crm-operation-receipt--${receipt.outcome}`}
        role={receipt.outcome === "failed" ? "alert" : "status"}
        aria-live={receipt.outcome === "failed" ? "assertive" : "polite"}
        data-operation-id={receipt.evidence.operationId}
      >
        <p className="crm-operation-receipt__eyebrow">Квитанция операции</p>
        <h2>{receipt.title}</h2>
        <p>{receipt.message}</p>
        {receipt.evidence.requestId ||
        receipt.evidence.receiptId ||
        receipt.evidence.completedAt ? (
          <dl className="crm-operation-evidence">
            {receipt.evidence.requestId ? (
              <div className="crm-operation-evidence__item">
                <dt>Код запроса</dt>
                <dd>{receipt.evidence.requestId}</dd>
              </div>
            ) : null}
            {receipt.evidence.receiptId ? (
              <div className="crm-operation-evidence__item">
                <dt>Код квитанции</dt>
                <dd>{receipt.evidence.receiptId}</dd>
              </div>
            ) : null}
            {receipt.evidence.completedAt ? (
              <div className="crm-operation-evidence__item">
                <dt>Завершено</dt>
                <dd>{receipt.evidence.completedAt}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {receipt.items?.length ? (
          <ul className="crm-operation-receipt__items">
            {receipt.items.map((item) => (
              <li key={item.id}>
                <span>{item.label}</span>
                <strong>{item.outcome}</strong>
                {item.retryable ? <span>Допустим повтор через новый preview</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {onOpenReceiptTarget ? (
          <button
            type="button"
            className="crm-button crm-button--primary"
            onClick={onOpenReceiptTarget}
          >
            Открыть запись
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="crm-operation-preview"
      aria-labelledby={titleId}
      data-operation-id={operationId}
    >
      <p className="crm-operation-preview__eyebrow">
        {phase === "draft" ? "Черновик" : "Проверка перед изменением"}
      </p>
      <h2 id={titleId}>{title}</h2>
      {description ? <p className="crm-operation-preview__description">{description}</p> : null}
      {children}
      {previewItems.length > 0 ? (
        <dl className="crm-operation-preview__items">
          {previewItems.map((item) => (
            <div
              className={`crm-operation-preview__item is-${item.tone ?? "neutral"}`}
              key={item.label}
            >
              <dt>{item.label}</dt>
              <dd>
                {item.before ? (
                  <span className="crm-operation-preview__before">{item.before}</span>
                ) : null}
                <span>{item.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="crm-operation-preview__operation">Операция будет подтверждена сервером.</p>
      <div className="crm-operation-preview__actions">
        {onCancel ? (
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={pending}
            onClick={onCancel}
          >
            Отмена
          </button>
        ) : null}
        {phase === "draft" ? (
          <button
            type="button"
            className="crm-button crm-button--primary"
            disabled={pending || !onRequestPreview}
            onClick={onRequestPreview}
          >
            Проверить изменения
          </button>
        ) : (
          <button
            type="button"
            className="crm-button crm-button--primary"
            disabled={pending || !onConfirm}
            onClick={onConfirm}
          >
            {pending ? "Выполняется…" : confirmLabel}
          </button>
        )}
      </div>
    </section>
  );
}
