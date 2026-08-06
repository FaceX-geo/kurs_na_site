// component-id: ui.entity-360
import { Entity360, StatusPill } from "@/shared/ui";

export function Entity360Snippet() {
  return (
    <Entity360
      title="Тестовая карточка"
      subtitle="Разрешённый контекст записи"
      status={<StatusPill status="in_work" label="В работе" tone="work" />}
      provenance={[{ label: "Источник", value: "Тестовая заявка" }]}
      sections={[
        {
          id: "contact",
          title: "Контакты",
          facts: [
            { label: "Телефон", value: "+7 *** ***-**-10", sensitive: true },
            { label: "Регион", value: "Мурманская область" },
          ],
        },
      ]}
      timeline={[
        {
          id: "EVENT-DEMO-001",
          title: "Запись создана",
          timestamp: "2026-08-06T09:00:00+03:00",
          sourceLabel: "CRM",
        },
      ]}
    />
  );
}
