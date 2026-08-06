// component-id: ui.kanban-board
import { useState } from "react";
import { KanbanBoard } from "@/shared/ui";

const columns = [
  { id: "new", title: "Новое", tone: "new" as const },
  { id: "work", title: "В работе", tone: "work" as const },
  { id: "done", title: "Завершено", tone: "done" as const },
];

const cards = [
  { id: "CASE-DEMO-001", columnId: "new", title: "Тестовая запись", subtitle: "Следующий шаг задан" },
];

export function KanbanBoardSnippet() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <KanbanBoard
      columns={columns}
      cards={cards}
      selectedId={selectedId}
      onOpenCard={(card) => setSelectedId(card.id)}
      onMoveRequest={() => undefined}
    />
  );
}
