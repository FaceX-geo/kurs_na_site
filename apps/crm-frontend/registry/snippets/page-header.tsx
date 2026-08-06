// component-id: ui.page-header
import { PageHeader } from "@/shared/ui";

export function PageHeaderSnippet() {
  return (
    <PageHeader
      eyebrow="Рабочая выборка"
      title="Все участники"
      description="Поиск людей и разрешённых ролей без подмены контакта кандидатом."
      breadcrumb={[{ id: "people", label: "Участники" }]}
      actions={<button type="button">Добавить участника</button>}
    />
  );
}
