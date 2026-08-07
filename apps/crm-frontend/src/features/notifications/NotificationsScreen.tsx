import {
  IconBell,
  IconBriefcase,
  IconCalendarEvent,
  IconClockExclamation,
  IconMail,
  IconUserPlus,
} from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import {
  crmApi,
  hasRepeatedNextCursor,
  type NotificationsResponse,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { CursorPagination, PageHeader, StateMessage, StatusPill } from "@/shared/ui";
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
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const notifications = useInfiniteQuery({
    queryKey: ["crm", "notifications", unreadOnly, typeCode],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listNotifications({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(unreadOnly ? { unreadOnly: true } : {}),
        ...(typeCode ? { typeCode } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const markRead = useMutation({
    mutationFn: (item: NotificationRow) => crmApi.markNotificationRead(item.id, item.version),
    onSuccess: (updated) => {
      setAnnouncement(`Уведомление «${updated.title}» отмечено прочитанным.`);
      void queryClient.invalidateQueries({ queryKey: ["crm", "notifications"] });
    },
  });

  const loadedPages = notifications.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const items = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
  const hasVisibleData = items.length > 0;
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const types = useMemo(
    () =>
      Array.from(
        new Set([
          ...(typeCode ? [typeCode] : []),
          ...loadedPages.flatMap((page) => page.items.map((item) => item.typeCode)),
        ]),
      ).sort(),
    [loadedPages, typeCode],
  );
  const state = notifications.isPending
    ? "loading"
    : notifications.isError && !hasVisibleData
      ? notifications.error instanceof ApiError && notifications.error.status === 403
        ? "denied"
        : "error"
      : items.length === 0
        ? "empty"
        : "ready";

  const fetchNextAndAdvance = async () => {
    if (repeatedCursor) return;
    const before = loadedPages.length;
    const result = await notifications.fetchNextPage();
    const after = result.data?.pages.length ?? before;
    if (after > before) {
      setSelectedId("");
      setCurrentPageIndex(after - 1);
    }
  };

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
          onClick={() => {
            setSelectedId("");
            setCurrentPageIndex(0);
            setUnreadOnly((current) => !current);
          }}
        >
          <IconBell aria-hidden size={18} />
          Только непрочитанные
        </button>
        <label>
          <span>Тип</span>
          <select
            value={typeCode}
            onChange={(event) => {
              setSelectedId("");
              setCurrentPageIndex(0);
              setTypeCode(event.currentTarget.value);
            }}
          >
            <option value="">Все события</option>
            {types.map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>

      {state !== "ready" ? (
        <StateMessage
          state={state}
          title={
            state === "loading"
              ? "Загружаем уведомления"
              : state === "denied"
                ? "Уведомления недоступны"
                : state === "error"
                  ? "Не удалось загрузить уведомления"
                  : "Уведомлений по выбранным условиям нет"
          }
          {...(notifications.isError ? { message: notifications.error.message } : {})}
          {...(state === "error"
            ? { action: { label: "Повторить", onPress: () => void notifications.refetch() } }
            : {})}
        />
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
      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel="Пагинация уведомлений"
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(notifications.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={items.length}
          isFetchingNextPage={notifications.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={(pageIndex) => {
            setSelectedId("");
            setCurrentPageIndex(pageIndex);
          }}
          onFetchNextPage={fetchNextAndAdvance}
        />
      ) : null}
      {notifications.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={notifications.error.message}
          action={{ label: "Повторить", onPress: () => void fetchNextAndAdvance() }}
        />
      ) : null}
      <p className="crm-sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
