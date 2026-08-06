import { IconX } from "@tabler/icons-react";
import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";

export type ModalCloseReason = "close-button" | "escape" | "backdrop" | "cancel";

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: (reason: ModalCloseReason) => void;
  description?: string;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  size?: "narrow" | "standard" | "wide";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({
  open,
  title,
  children,
  onClose,
  description,
  footer,
  initialFocusRef,
  dismissible = true,
  size = "standard",
}: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const requestedFocus = initialFocusRef?.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (requestedFocus ?? firstFocusable ?? dialog)?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onClose("escape");
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last && first) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      invokerRef.current?.focus();
    };
  }, [dismissible, initialFocusRef, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="crm-modal-layer">
      {dismissible ? (
        <button
          type="button"
          className="crm-modal-layer__backdrop"
          aria-label="Закрыть модальное окно"
          tabIndex={-1}
          onClick={() => onClose("backdrop")}
        />
      ) : null}
      <section
        ref={dialogRef}
        className={`crm-modal crm-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="crm-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              className="crm-modal__close"
              aria-label="Закрыть окно"
              onClick={() => onClose("close-button")}
            >
              <IconX aria-hidden="true" size={20} stroke={2} />
            </button>
          ) : null}
        </header>
        <div className="crm-modal__body">{children}</div>
        {footer ? <footer className="crm-modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
