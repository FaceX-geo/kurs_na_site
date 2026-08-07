import {
  IconBell,
  IconBriefcase,
  IconCalendar,
  IconClock,
  IconFileDescription,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import { crmApi } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { useAuth } from "@/shared/auth";
import { PageHeader, StateMessage } from "@/shared/ui";
import "@/features/dashboard/dashboard.css";

const SCOPE_LABEL = {
  assigned: "Только назначенные мне записи",
  team: "Записи моей команды",
  department: "Записи подразделения",
  all: "Вся CRM",
} as const;

export function DashboardScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const dashboard = useQuery({
    queryKey: ["crm", "dashboard", "Europe/Moscow"],
    queryFn: () => crmApi.getDashboard(),
  });
  const firstName =
    session?.displayName?.split(" ")[0] ??
    (session?.businessRole === "SUPER_ADMIN" ? "Администратор" : "Специалист");

  if (dashboard.isPending) {
    return (
      <div className="dashboard-screen">
        <PageHeader title={`Добрый день, ${firstName}.`} />
        <StateMessage
          state="loading"
          title="Загружаем рабочую область"
          message="Backend формирует показатели в пределах effective scope текущего пользователя."
        />
      </div>
    );
  }

  if (dashboard.isError) {
    const denied = dashboard.error instanceof ApiError && dashboard.error.status === 403;
    return (
      <div className="dashboard-screen">
        <PageHeader title={`Добрый день, ${firstName}.`} />
        <StateMessage
          state={denied ? "denied" : "error"}
          title={denied ? "Рабочая область недоступна" : "Не удалось загрузить рабочую область"}
          message={dashboard.error.message}
          {...(denied
            ? {}
            : { action: { label: "Повторить", onPress: () => void dashboard.refetch() } })}
        />
      </div>
    );
  }

  const data = dashboard.data;
  return (
    <div className="dashboard-screen">
      <PageHeader
        title={`Добрый день, ${firstName}.`}
        description={`${SCOPE_LABEL[data.scopeVisibility]}. Данные обновлены ${new Date(data.dataFreshAt).toLocaleString("ru-RU")}.`}
      />

      <section className="dashboard-metrics" aria-label="Рабочие показатели">
        <Metric icon={IconBriefcase} label="Открытые заявки" value={data.openCaseCount} />
        <Metric
          icon={IconClock}
          label="Просроченные задачи"
          value={data.overdueTaskCount}
          tone="danger"
        />
        <Metric
          icon={IconCalendar}
          label="Ожидают работодателя"
          value={data.pendingReferralCount}
        />
        <Metric icon={IconBell} label="Новые уведомления" value={data.unreadNotificationCount} />
        <Metric
          icon={IconFileDescription}
          label="Мои черновики"
          value={data.ownDraftCommunicationCount}
        />
      </section>

      <div className="dashboard-queues">
        <button
          type="button"
          className="dashboard-queue"
          onClick={() => navigate(CRM_PATHS.relocation)}
        >
          <IconBriefcase aria-hidden size={22} />
          <strong>
            {data.scopeVisibility === "all" ? "Открыть все заявки" : "Открыть доступные заявки"}
          </strong>
        </button>
        <button
          type="button"
          className="dashboard-queue"
          onClick={() => navigate(`${CRM_PATHS.tasks}?filter=overdue`)}
        >
          <IconClock aria-hidden size={22} />
          <strong>Разобрать просроченные задачи</strong>
        </button>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof IconClock;
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className={tone ? `dashboard-metric is-${tone}` : "dashboard-metric"}>
      <Icon aria-hidden="true" size={22} stroke={1.7} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
