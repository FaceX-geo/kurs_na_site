import type { ReactNode } from "react";

export type KanbanTone = "new" | "review" | "documents" | "selection" | "waiting" | "work" | "done";

export interface KanbanColumn {
  id: string;
  title: string;
  tone: KanbanTone;
  description?: string;
}

export interface KanbanCard {
  id: string;
  columnId: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  meta?: readonly { label: string; value: ReactNode }[];
}

export interface KanbanBoardProps {
  columns: readonly KanbanColumn[];
  cards: readonly KanbanCard[];
  view?: "kanban" | "list";
  selectedId?: string | null;
  onOpenCard?: (card: KanbanCard) => void;
  onMoveRequest?: (event: { card: KanbanCard; targetColumnId: string }) => void;
  ariaLabel?: string;
  empty?: ReactNode;
}

export function KanbanBoard({
  columns,
  cards,
  view = "kanban",
  selectedId = null,
  onOpenCard,
  onMoveRequest,
  ariaLabel = "Доска",
  empty,
}: KanbanBoardProps) {
  if (cards.length === 0) {
    return <div className="crm-kanban__empty">{empty ?? "Нет записей для выбранных условий."}</div>;
  }

  if (view === "list") {
    return (
      <ul className="crm-kanban-list" aria-label={`${ariaLabel}: режим списка`}>
        {cards.map((card) => {
          const column = columns.find((item) => item.id === card.columnId);
          return (
            <li className={card.id === selectedId ? "is-selected" : undefined} key={card.id}>
              <button type="button" onClick={() => onOpenCard?.(card)}>
                <span className="crm-kanban-list__title">{card.title}</span>
                {card.subtitle ? <span>{card.subtitle}</span> : null}
                <span>{column?.title ?? "Этап не определён"}</span>
                {card.badge}
              </button>
              {onMoveRequest ? (
                <label>
                  <span className="crm-sr-only">Запросить изменение этапа для «{card.title}»</span>
                  <select
                    value={card.columnId}
                    onChange={(event) =>
                      onMoveRequest({ card, targetColumnId: event.target.value })
                    }
                  >
                    {columns.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="crm-kanban" aria-label={ariaLabel}>
      {columns.map((column, columnIndex) => {
        const columnCards = cards.filter((card) => card.columnId === column.id);
        return (
          <section
            className={`crm-kanban-column crm-kanban-column--${column.tone}`}
            aria-labelledby={`crm-kanban-column-${column.id}`}
            key={column.id}
          >
            <header>
              <div>
                <p className="crm-kanban-column__number">
                  {String(columnIndex + 1).padStart(2, "0")}
                </p>
                <h2 id={`crm-kanban-column-${column.id}`}>{column.title}</h2>
                {column.description ? <p>{column.description}</p> : null}
              </div>
              <span>
                {columnCards.length}
                <span className="crm-sr-only"> записей</span>
              </span>
            </header>
            <div className="crm-kanban-column__cards">
              {columnCards.length > 0 ? (
                columnCards.map((card) => (
                  <article
                    className={`crm-kanban-card${card.id === selectedId ? " is-selected" : ""}`}
                    key={card.id}
                  >
                    <button
                      type="button"
                      className="crm-kanban-card__open"
                      onClick={() => onOpenCard?.(card)}
                    >
                      <span className="crm-kanban-card__title">{card.title}</span>
                      {card.subtitle ? (
                        <span className="crm-kanban-card__subtitle">{card.subtitle}</span>
                      ) : null}
                    </button>
                    {card.badge ? <div className="crm-kanban-card__badge">{card.badge}</div> : null}
                    {card.meta?.length ? (
                      <dl>
                        {card.meta.map((item) => (
                          <div key={item.label}>
                            <dt>{item.label}</dt>
                            <dd>{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {onMoveRequest ? (
                      <label className="crm-kanban-card__move">
                        <span>Изменить этап через preview</span>
                        <select
                          value={card.columnId}
                          onChange={(event) =>
                            onMoveRequest({ card, targetColumnId: event.target.value })
                          }
                        >
                          {columns.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="crm-kanban-column__empty">На этом этапе записей нет.</p>
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}
