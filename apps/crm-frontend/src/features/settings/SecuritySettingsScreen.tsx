import {
  IconAlertTriangle,
  IconClock,
  IconDeviceDesktop,
  IconLock,
  IconLogout,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { crmApi, type OwnSessionListResponse } from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import {
  Modal,
  type OperationPhase,
  PageHeader,
  PreviewConfirmReceipt,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import "./settings.css";

type SessionRow = OwnSessionListResponse["items"][number];

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SecuritySettingsScreen() {
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [phase, setPhase] = useState<OperationPhase>("draft");
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: () => crmApi.listOwnSessions(100),
  });
  const revoke = useMutation({
    mutationFn: (session: SessionRow) =>
      crmApi.revokeOwnSession(session.id, "Пользователь завершил собственный сеанс через CRM"),
    onSuccess: () => {
      setPhase("receipt");
      void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  const closeSessionPreview = () => {
    if (revoke.isPending) return;
    setSelectedSession(null);
    setPhase("draft");
    revoke.reset();
  };

  return (
    <div className="settings-screen security-settings-screen">
      <PageHeader
        title="Безопасность и сеансы"
        description="Активные серверные сеансы текущей учётной записи и контролируемый отзыв одного сеанса."
      />

      <StateMessage
        state="stale"
        icon={<IconAlertTriangle aria-hidden size={24} />}
        title="Граница backend-контракта"
        message="Список не содержит устройство, геолокацию или признак текущего браузера. UI не подставляет эти данные и предупреждает перед отзывом. Перепривязка фактора и dual-control recovery остаются закрыты до отдельного контракта."
      />

      <p className="security-flow-note">
        <IconShieldCheck aria-hidden size={22} />
        Отзыв: выбор сеанса → preview → подтверждённая backend-операция → квитанция
      </p>

      <section className="security-sessions" aria-labelledby="security-sessions-title">
        <header>
          <div>
            <IconDeviceDesktop aria-hidden size={24} />
            <h2 id="security-sessions-title">
              Активные сеансы{sessions.data ? ` · ${sessions.data.items.length}` : ""}
            </h2>
          </div>
          <p>Отзыв текущего сеанса завершит доступ в этом браузере.</p>
        </header>

        {sessions.isPending ? <StateMessage state="loading" title="Загружаем сеансы" /> : null}
        {sessions.isError ? (
          <StateMessage
            state={
              sessions.error instanceof ApiError && sessions.error.status === 401
                ? "denied"
                : "error"
            }
            title="Не удалось загрузить сеансы"
            message={sessions.error.message}
            action={{ label: "Повторить", onPress: () => void sessions.refetch() }}
          />
        ) : null}
        {sessions.data?.items.length === 0 ? (
          <StateMessage state="empty" title="Активных сеансов нет" />
        ) : null}

        {sessions.data?.items.length ? (
          <ul>
            {sessions.data.items.map((session) => (
              <li key={session.id}>
                <IconDeviceDesktop aria-hidden size={22} />
                <div>
                  <strong>Сеанс CRM</strong>
                  <span>Идентификатор: {session.id}</span>
                </div>
                <dl>
                  <div>
                    <dt>
                      <IconClock aria-hidden size={16} /> Последняя активность
                    </dt>
                    <dd>{formatTimestamp(session.lastSeenAt)}</dd>
                  </div>
                  <div>
                    <dt>Уровень</dt>
                    <dd>{session.authenticationLevel}</dd>
                  </div>
                  <div>
                    <dt>Истекает</dt>
                    <dd>{formatTimestamp(session.absoluteExpiresAt)}</dd>
                  </div>
                </dl>
                <StatusPill
                  status={session.authenticationLevel}
                  label={session.authenticationLevel}
                  tone={session.authenticationLevel === "fresh_mfa" ? "success" : "neutral"}
                />
                <button
                  type="button"
                  className="crm-button crm-button--quiet"
                  onClick={() => {
                    setSelectedSession(session);
                    setPhase("draft");
                    revoke.reset();
                  }}
                >
                  <IconLogout aria-hidden size={18} />
                  Завершить сеанс
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Modal
        open={selectedSession !== null}
        title="Завершить сеанс"
        description="Проверьте точный сеанс. Backend может завершить текущий браузер, потому что контракт не помечает его отдельно."
        onClose={closeSessionPreview}
      >
        {selectedSession ? (
          <>
            <PreviewConfirmReceipt
              phase={phase}
              title="Завершение сеанса"
              operationId="RevokeOwnSession"
              previewItems={[
                { label: "Сеанс", after: selectedSession.id },
                { label: "Создан", after: formatTimestamp(selectedSession.createdAt) },
                {
                  label: "Последняя активность",
                  after: formatTimestamp(selectedSession.lastSeenAt),
                },
                {
                  label: "Риск",
                  after: "Если это текущий сеанс, потребуется повторный вход",
                  tone: "attention",
                },
              ]}
              pending={revoke.isPending}
              receipt={
                phase === "receipt"
                  ? {
                      title: "Сеанс завершён",
                      message: "Backend подтвердил отзыв выбранного сеанса.",
                      outcome: "complete",
                      evidence: {
                        operationId: "RevokeOwnSession",
                      },
                      items: [
                        {
                          id: selectedSession.id,
                          label: "Сеанс",
                          outcome: "Backend подтвердил отзыв",
                        },
                      ],
                    }
                  : null
              }
              confirmLabel="Завершить этот сеанс"
              onRequestPreview={() => setPhase("preview")}
              onConfirm={() => {
                setPhase("executing");
                revoke.mutate(selectedSession);
              }}
              onCancel={closeSessionPreview}
              onOpenReceiptTarget={closeSessionPreview}
            />
            {revoke.isError ? (
              <StateMessage
                state={
                  revoke.error instanceof ApiError && revoke.error.status === 409
                    ? "conflict"
                    : "error"
                }
                icon={<IconLock aria-hidden size={22} />}
                title="Сеанс не завершён"
                message={revoke.error.message}
              />
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
