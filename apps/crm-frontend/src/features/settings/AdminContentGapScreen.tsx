import { IconDatabaseOff } from "@tabler/icons-react";
import { PageHeader, StateMessage } from "@/shared/ui";

export interface AdminContentGapScreenProps {
  kind: "stories" | "vacancies";
}

const COPY = {
  vacancies: {
    title: "Вакансии лендинга",
    message:
      "Текущий OpenAPI содержит только публичное чтение вакансий. Создание, редактирование и публикация станут доступны после появления versioned operationId.",
  },
  stories: {
    title: "Истории лендинга",
    message:
      "В текущем OpenAPI нет операций чтения и изменения историй. CRM не сохраняет такие данные локально и не подменяет backend браузерным хранилищем.",
  },
} as const;

export function AdminContentGapScreen({ kind }: AdminContentGapScreenProps) {
  const copy = COPY[kind];
  return (
    <div className="settings-screen">
      <PageHeader
        eyebrow="Супер-администратор"
        title={copy.title}
        description="Публикационный контур лендинга подключается только через версионированный backend-контракт."
      />
      <StateMessage
        state="stale"
        icon={<IconDatabaseOff aria-hidden size={24} />}
        title="Контракт ещё не опубликован"
        message={copy.message}
      />
    </div>
  );
}
