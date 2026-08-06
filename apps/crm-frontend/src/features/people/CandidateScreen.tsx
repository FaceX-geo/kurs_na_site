import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { crmApi } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { Entity360, StateMessage, StatusPill } from "@/shared/ui";
import "./people.css";

export function CandidateScreen() {
  const { caseId = "" } = useParams();
  const caseQuery = useQuery({
    queryKey: ["crm", "case", caseId],
    queryFn: () => crmApi.getCase(caseId),
    enabled: Boolean(caseId),
  });
  const personId = caseQuery.data?.primaryPersonId ?? null;
  const personQuery = useQuery({
    queryKey: ["crm", "person-summary", personId],
    queryFn: () => crmApi.getCandidateSummary(personId ?? ""),
    enabled: Boolean(personId),
  });

  if (caseQuery.isPending) {
    return <StateMessage state="loading" title="Загружаем назначенную заявку" />;
  }
  if (caseQuery.isError) {
    const denied = caseQuery.error instanceof ApiError && caseQuery.error.status === 403;
    return (
      <StateMessage
        state={denied ? "denied" : "error"}
        title={denied ? "Эта заявка вам не назначена" : "Не удалось открыть заявку"}
        message={caseQuery.error.message}
        {...(denied
          ? {}
          : { action: { label: "Повторить", onPress: () => void caseQuery.refetch() } })}
      />
    );
  }

  const item = caseQuery.data;
  const person = personQuery.data?.person;
  return (
    <div className="candidate-screen">
      <Entity360
        title={person?.displayName ?? item.title}
        subtitle={`${item.publicId} · ${item.funnelCode}`}
        status={<StatusPill status={item.status} label={item.status} />}
        provenance={[
          { label: "Версия", value: item.version },
          { label: "Обновлено", value: new Date(item.updatedAt).toLocaleString("ru-RU") },
          { label: "Scope", value: "Проверен backend" },
        ]}
        sections={[
          {
            id: "case",
            title: "Заявка",
            facts: [
              { label: "Этап", value: item.stageCode },
              { label: "Следующий шаг", value: item.nextStep ?? "Не назначен" },
              {
                label: "Ответственный profile ID",
                value: item.ownerEmployeeProfileId ?? "Не назначен",
              },
            ],
          },
          {
            id: "person",
            title: "Участник",
            facts: person
              ? [
                  { label: "Состояние профиля", value: person.profileState },
                  { label: "Качество данных", value: person.dataQualityState },
                  { label: "Email", value: person.contactMask.email ?? "Скрыт", sensitive: true },
                  { label: "Телефон", value: person.contactMask.phone ?? "Скрыт", sensitive: true },
                ]
              : [{ label: "Связь", value: "Основной участник не назначен" }],
          },
          {
            id: "assignments",
            title: "Ассоциации специалистов",
            facts:
              item.assignments.length > 0
                ? item.assignments.map((assignment) => ({
                    label: assignment.role,
                    value: assignment.employeeProfileId ?? assignment.legacyActorId ?? "Не связан",
                  }))
                : [{ label: "Ассоциации", value: "Нет активных связей" }],
          },
        ]}
      />
      {personQuery.isError ? (
        <StateMessage
          state={
            personQuery.error instanceof ApiError && personQuery.error.status === 403
              ? "denied"
              : "error"
          }
          title="Сводка участника недоступна"
          message={personQuery.error.message}
        />
      ) : null}
    </div>
  );
}
