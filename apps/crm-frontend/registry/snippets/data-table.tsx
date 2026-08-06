// component-id: ui.data-table
import { useState } from "react";
import { DataTable, StatusPill, type DataTableColumn } from "@/shared/ui";

interface ExampleRow {
  id: string;
  title: string;
  status: string;
  nextStep: string;
}

const rows: ExampleRow[] = [
  { id: "CASE-DEMO-001", title: "Тестовая запись", status: "in_work", nextStep: "Проверить данные" },
];

const columns: DataTableColumn<ExampleRow>[] = [
  { id: "title", label: "Запись", render: (row) => row.title },
  { id: "status", label: "Статус", render: (row) => <StatusPill status={row.status} label="В работе" tone="work" /> },
  { id: "nextStep", label: "Следующий шаг", render: (row) => row.nextStep },
];

export function DataTableSnippet() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <DataTable
      caption="Тестовые записи"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onOpenRow={(row) => setSelectedId(row.id)}
    />
  );
}
