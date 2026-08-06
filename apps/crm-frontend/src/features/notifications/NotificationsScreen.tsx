import {
  IconBell,
  IconBriefcase,
  IconCalendarEvent,
  IconClockExclamation,
  IconMail,
  IconUserPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { crmApi, type NotificationsResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { PageHeader, StateMessage, StatusPill } from "@/shared/ui";
import "./notifications.css";

type NotificationRow = NotificationsResponse["items"][number];
type NotificationGroup = "unread" | "today" | "earlier";

const GROUP_LABEL: Record<NotificationGroup, string> = {
  unread: "Непрочитанные",
  today: "Сегодня",
  earlier: "Ранее",
};

function includesType(typeCode: string, fragment: string): boolean {
  return typeCode.toLocaleLowerCase("en-US").includes(fragment);
}

function NotificationIcon({ typeCode }: { typeCode: string }) {
  const iconProps = { "aria-hidden": true, size: 21 } as const;
  let icon: ReactNode = <IconBell {...iconProps} />;
  if (includesType(typeCode, "application")) icon = <IconUserPlus {...iconProps} />;
  if (includesType(typeCode, "deadline")) icon = <IconClockExclamation {...iconProps} />;
  if (includesType(typeCode, "mail") || includesType(typeCode, "communication")) {
    icon = <IconMail {...iconProps} />;
  }
  if (includesType(typeCode, "relocation")) icon = <IconCalendarEvent {...iconProps} />;
  if (includesType(typeCode, "stage")) icon = <IconBriefcase {...iconProps} />;
  return icon;
}

function groupFor(item: NotificationRow): NotificationGroup {
  if (!item.readAt) return "unread";
  const occurredAt = new Date(item.occurredAt);
  const now = new Date();
  return occurredAt.toDateString() === now.toDateString() ? "today" : "earlier";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function payloadSummary(payload: NotificationRow["payload"]): string | null {
  for (const key of ["message", "detail", "summary", "bodyPreview", "casePublicId"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typeCode, setTypeCode] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const notifications = useQuery({
    queryKey: ["crm", "notifications", unreadOnly, typeCode],
    queryFn: () =>
      crmApi.listNotifications({
        limit: 100,
        ...(unreadOnly ? { unreadOnly: true } : {}),
        ...(typeCode ? { typeCode } : {}),
      }),
  });
  const markRead = useMutation({
    mutationFn: (item: NotificationRow) => crmApi.markNotificationRead(item.id, item.version),
    onSuccess: (updated) => {
      setAnnouncement(`Уведомление «${updated.title}» отмечено прочитанным.`);
      void queryClient.invalidateQueries({ queryKey: ["crm", "notifications"] });
    },
  });

  const items = notifications.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const types = useMemo(
    () => Array.from(new Set(items.map((item) => item.typeCode))).sort(),
    [items],
  );

  if (notifications.isPending) {
    return <StateMessage state="loading" title="Загружаем уведомления" />;
  }
  if (notifications.isError) {
    const denied = notifications.error instanceof ApiError && notifications.error.status === 403;
    return (
      <StateMessage
        state={denied ? "denied" : "error"}
        title={denied ? "Уведомления недоступны" : "Не удалось загрузить уведомления"}
        message={notifications.error.message}
        {...(denied
          ? {}
          : { action: { label: "Повторить", onPress: () => void notifications.refetch() } })}
      />
    );
  }

  return (
    <div className="notifications-screen">
      <PageHeader
        title="Уведомления"
        description="События, разрешённые текущей роли и эффективным backend scope."
      />

      <section className="notifications-toolbar" aria-label="Фильтры уведомлений">
        <button
          type="button"
          className={unreadOnly ? "is-active" : undefined}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((current) => !current)}
        >
          <IconBell aria-hidden size={18} />
          Только непрочитанные
        </button>
        <label>
          <span>Тип</span>
          <select value={typeCode} onChange={(event) => setTypeCode(event.currentTarget.value)}>
            <option value="">Все события</option>
            {types.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>

      {items.length === 0 ? (
        <StateMessage state="empty" title="Уведомлений по выбранным условиям нет" />
      ) : (
        <div className="notifications-layout">
          <div className="notifications-groups">
            {(["unread", "today", "earlier"] as const).map((group) => {
              const groupItems = items.filter((item) => groupFor(item) === group);
              if (groupItems.length === 0) return null;
              return (
                <section aria-labelledby={`notification-group-${group}`} key={group}>
                  <h2 id={`notification-group-${group}`}>{GROUP_LABEL[group]}</h2>
                  <ul>
                    {groupItems.map((item) => (
                      <li
                        className={`${item.id === selected?.id ? "is-selected" : ""}${item.readAt ? " is-read" : ""}`}
                        key={item.id}
                      >
                        <button type="button" onClick={() => setSelectedId(item.id)}>
                          <span className="notifications-item__icon">
                            <NotificationIcon typeCode={item.typeCode} />
                          </span>
                          <span className="notifications-item__copy">
                            <span>
                              <strong>{item.title}</strong>
                              <time dateTime={item.occurredAt}>
                                {formatTimestamp(item.occurredAt)}
                              </time>
                            </span>
                            <span>{item.typeCode}</span>
                            {payloadSummary(item.payload) ? (
                              <small>{payloadSummary(item.payload)}</small>
                            ) : null}
                          </span>
                          {!item.readAt ? (
                            <span className="notifications-item__new">Новое</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {selected ? (
            <aside className="notifications-detail" aria-labelledby="notification-detail-title">
              <span className="notifications-detail__icon notifications-item__icon">
                <NotificationIcon typeCode={selected.typeCode} />
              </span>
              <p>{selected.typeCode}</p>
              <h2 id="notification-detail-title">{selected.title}</h2>
              {payloadSummary(selected.payload) ? (
                <span>{payloadSummary(selected.payload)}</span>
              ) : null}
              <time dateTime={selected.occurredAt}>{formatTimestamp(selected.occurredAt)}</time>
              <StatusPill
                status={selected.readAt ? "read" : "unread"}
                label={selected.readAt ? "Прочитано" : "Не прочитано"}
                tone={selected.readAt ? "neutral" : "work"}
              />
              {!selected.readAt ? (
                <button
                  type="button"
                  className="crm-button crm-button--primary"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(selected)}
                >
                  {markRead.isPending ? "Сохраняем…" : "Отметить прочитанным"}
                </button>
              ) : null}
              {markRead.isError ? (
                <StateMessage
                  state={
                    markRead.error instanceof ApiError && markRead.error.status === 409
                      ? "conflict"
                      : "error"
                  }
                  title="Статус не изменён"
                  message={markRead.error.message}
                />
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
      <p className="crm-sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
