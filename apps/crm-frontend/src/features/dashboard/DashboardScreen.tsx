import {
  IconArrowRight,
  IconBell,
  IconBriefcase,
  IconCalendar,
  IconClock,
  IconFileDescription,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
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
  const caseQueue = useQuery({
    queryKey: ["crm", "dashboard", "cases", "relocation"],
    queryFn: () => crmApi.listCases({ funnelCode: "relocation", status: "open", limit: 5 }),
  });
  const taskQueue = useQuery({
    queryKey: ["crm", "dashboard", "tasks", "overdue"],
    queryFn: () => crmApi.listTasks({ overdue: true, limit: 5 }),
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
        eyebrow="Моя работа"
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

      <section className="dashboard-focus" aria-label="Очередь решений">
        <header>
          <div>
            <p>Очередь решений</p>
            <h2>С чего начать сегодня</h2>
          </div>
          <span>{SCOPE_LABEL[data.scopeVisibility]}</span>
        </header>
        <div className="dashboard-focus-grid">
          <QueuePanel
            title="Открытые заявки на переезд"
            icon={<IconBriefcase aria-hidden size={20} />}
            loading={caseQueue.isPending}
            error={caseQueue.isError}
            empty="Открытых заявок в доступном scope нет."
            items={(caseQueue.data?.items ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              meta: `${item.publicId} · ${item.stageCode}`,
              onOpen: () => navigate(CRM_PATHS.case(item.id)),
            }))}
            onOpenAll={() => navigate(`${CRM_PATHS.relocation}?view=list&status=open`)}
          />
          <QueuePanel
            title="Просроченные задачи"
            icon={<IconClock aria-hidden size={20} />}
            loading={taskQueue.isPending}
            error={taskQueue.isError}
            empty="Просроченных задач в доступном scope нет."
            items={(taskQueue.data?.items ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              meta: item.dueAt
                ? `${item.publicId} · срок ${new Date(item.dueAt).toLocaleDateString("ru-RU")}`
                : `${item.publicId} · без срока`,
              onOpen: () => navigate(`${CRM_PATHS.tasks}?view=list&overdue=true`),
            }))}
            onOpenAll={() => navigate(`${CRM_PATHS.tasks}?view=list&overdue=true`)}
          />
        </div>
      </section>
    </div>
  );
}

function QueuePanel({
  title,
  icon,
  items,
  loading,
  error,
  empty,
  onOpenAll,
}: {
  title: string;
  icon: ReactNode;
  items: readonly { id: string; title: string; meta: string; onOpen: () => void }[];
  loading: boolean;
  error: boolean;
  empty: string;
  onOpenAll: () => void;
}) {
  return (
    <article className="dashboard-panel">
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
        <button type="button" onClick={onOpenAll}>
          Все
          <IconArrowRight aria-hidden size={16} />
        </button>
      </header>
      {loading ? (
        <p className="dashboard-panel-state">Загружаем очередь…</p>
      ) : error ? (
        <p className="dashboard-panel-state is-error">Очередь временно недоступна.</p>
      ) : items.length === 0 ? (
        <p className="dashboard-panel-state">{empty}</p>
      ) : (
        <ul>
          {items.slice(0, 4).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={item.onOpen}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
                <IconArrowRight aria-hidden size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
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
