import { IconX } from "@tabler/icons-react";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef } from "react";

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

interface OpenModalEntry {
  id: symbol;
  dialog: HTMLElement;
}

const openModalStack: OpenModalEntry[] = [];

function registerOpenModal(id: symbol, dialog: HTMLElement) {
  const existingIndex = openModalStack.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    openModalStack.splice(existingIndex, 1);
  }
  openModalStack.push({ id, dialog });
  openModalStack.sort((left, right) => {
    if (left.dialog.contains(right.dialog)) return -1;
    if (right.dialog.contains(left.dialog)) return 1;
    const position = left.dialog.compareDocumentPosition(right.dialog);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function unregisterOpenModal(id: symbol) {
  const wasTopmost = openModalStack.at(-1)?.id === id;
  const existingIndex = openModalStack.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    openModalStack.splice(existingIndex, 1);
  }
  return wasTopmost;
}

function isTopmostModal(id: symbol) {
  return openModalStack.at(-1)?.id === id;
}

function getFocusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      !element.hasAttribute("inert") &&
      element.closest("[hidden], [inert], [aria-hidden='true']") === null,
  );
}

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
  const modalIdRef = useRef(Symbol("crm-modal"));
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const initialFocusRefRef = useRef(initialFocusRef);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
    initialFocusRefRef.current = initialFocusRef;
  });

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const modalId = modalIdRef.current;
    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }
    registerOpenModal(modalId, dialog);
    const requestedFocus = initialFocusRefRef.current?.current;
    const firstFocusable = getFocusableElements(dialog)[0];
    (requestedFocus ?? firstFocusable ?? dialog)?.focus({ preventScroll: true });

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isTopmostModal(modalId)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (dismissibleRef.current) {
          onCloseRef.current("escape");
        }
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = getFocusableElements(dialog);

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      } else if (event.shiftKey && activeElement === first && last) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeElement === last && first) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const shouldRestoreFocus = unregisterOpenModal(modalId);
      const invoker = invokerRef.current;
      if (shouldRestoreFocus && invoker?.isConnected) {
        invoker.focus({ preventScroll: true });
      }
    };
  }, [open]);

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
          onClick={() => {
            if (isTopmostModal(modalIdRef.current)) {
              onClose("backdrop");
            }
          }}
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
