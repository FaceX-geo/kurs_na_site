import { IconIdBadge2, IconUserPlus } from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  createIdempotencyKey,
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
  type ProvisionableEmployeesResponse,
  type UsersResponse,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { FreshMfaGate, hasPermission, useAuth } from "@/shared/auth";
import {
  DataTable,
  type DataTableColumn,
  Modal,
  type OperationPhase,
  PageHeader,
  PreviewConfirmReceipt,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import "./settings.css";

type UserRow = UsersResponse["items"][number];
type EmployeeRow = ProvisionableEmployeesResponse["items"][number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleLabel(role: UserRow["businessRole"]): string {
  if (role === "SUPER_ADMIN") return "Супер-администратор";
  if (role === "SPECIALIST") return "Специалист";
  return "Не назначена";
}

export function AccessSettingsScreen() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<OperationPhase>("draft");
  const [provisionIdempotencyKey, setProvisionIdempotencyKey] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [freshMfaOpen, setFreshMfaOpen] = useState(false);
  const canReadUsers = hasPermission(session, "identity.users.read");
  const canReadEmployees = hasPermission(session, "identity.employees.read");
  const canProvision = hasPermission(session, "identity.specialists.provision");
  const mutationReady = session?.mutationAccess === "ready";

  const users = useInfiniteQuery({
    queryKey: ["crm", "admin", "users", search],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listUsers({
        limit: 200,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    getNextPageParam: nextCursorForPage,
    enabled: canReadUsers,
  });
  const employees = useInfiniteQuery({
    queryKey: ["crm", "admin", "provisionable-employees", employeeSearch],
    initialPageParam: "",
    enabled: canReadEmployees,
    queryFn: ({ pageParam }) =>
      crmApi.listProvisionableEmployees({
        limit: 100,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(employeeSearch.trim() ? { search: employeeSearch.trim() } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });

  const employeeRows = employees.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedEmployee = useMemo(
    () => employeeRows.find((employee) => employee.employeeProfileId === selectedEmployeeId),
    [employeeRows, selectedEmployeeId],
  );
  const provision = useMutation({
    mutationFn: () => {
      if (!selectedEmployee) throw new Error("Сотрудник не выбран.");
      if (!provisionIdempotencyKey) throw new Error("Черновик операции не зафиксирован.");
      return crmApi.provisionSpecialist(
        {
          employeeProfileId: selectedEmployee.employeeProfileId,
          email: email.trim(),
          reason: reason.trim(),
        },
        provisionIdempotencyKey,
      );
    },
    onSuccess: async () => {
      setPhase("receipt");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "admin", "users"] }),
        queryClient.invalidateQueries({
          queryKey: ["crm", "admin", "provisionable-employees"],
        }),
      ]);
    },
  });

  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];
  const repeatedCursor = hasRepeatedNextCursor(users.data?.pages ?? []);
  const repeatedEmployeeCursor = hasRepeatedNextCursor(employees.data?.pages ?? []);
  const state = !canReadUsers
    ? "denied"
    : users.isPending
      ? "loading"
      : users.isError
        ? users.error instanceof ApiError && users.error.status === 403
          ? "denied"
          : "error"
        : rows.length === 0
          ? "empty"
          : "ready";
  const employeeState = !canReadEmployees
    ? "denied"
    : employees.isPending
      ? "loading"
      : employees.isError
        ? employees.error instanceof ApiError && employees.error.status === 403
          ? "denied"
          : "error"
        : employeeRows.length === 0
          ? "empty"
          : "ready";
  const columns: readonly DataTableColumn<UserRow>[] = [
    { id: "name", label: "Пользователь", render: (row) => <strong>{row.displayName}</strong> },
    { id: "email", label: "Email", render: (row) => row.email },
    {
      id: "business-role",
      label: "Роль CRM",
      render: (row) => (
        <StatusPill
          status={row.businessRole ?? "unassigned"}
          label={roleLabel(row.businessRole)}
          tone={row.businessRole ? "work" : "attention"}
        />
      ),
    },
    {
      id: "employee-profile",
      label: "Профиль сотрудника",
      render: (row) => row.employeeProfileId ?? "Нет связи",
    },
    {
      id: "state",
      label: "Учётная запись",
      render: (row) => <StatusPill status={row.accountState} label={row.accountState} />,
    },
    {
      id: "mfa",
      label: "MFA",
      render: (row) => <StatusPill status={row.mfaState} label={row.mfaState} />,
    },
    { id: "sessions", label: "Сессии", render: (row) => row.activeSessions },
  ];
  const employeeColumns: readonly DataTableColumn<EmployeeRow>[] = [
    {
      id: "name",
      label: "Сотрудник",
      render: (row) => <strong>{row.displayName}</strong>,
    },
    {
      id: "employee-number",
      label: "Табельный номер",
      render: (row) => row.employeeNumber ?? "Не указан",
    },
    {
      id: "email",
      label: "Email",
      render: (row) => row.email ?? "Не указан",
    },
    {
      id: "organization-unit",
      label: "Подразделение",
      render: (row) => row.organizationUnitId ?? "Не связано",
    },
    {
      id: "employee-profile",
      label: "Employee profile",
      render: (row) => row.employeeProfileId,
    },
    {
      id: "state",
      label: "Статус",
      render: (row) => (
        <StatusPill status={row.employmentState} label={row.employmentState} tone="success" />
      ),
    },
  ];

  function resetProvisioning(): void {
    setDialogOpen(false);
    setFreshMfaOpen(false);
    setSelectedEmployeeId("");
    setEmail("");
    setReason("");
    setProvisionIdempotencyKey(null);
    setPhase("draft");
    setValidationMessage(null);
    provision.reset();
  }

  function chooseEmployee(employee: EmployeeRow): void {
    setSelectedEmployeeId(employee.employeeProfileId);
    setEmail(employee.email ?? "");
    setProvisionIdempotencyKey(null);
    setPhase("draft");
    setValidationMessage(null);
    provision.reset();
  }

  function requestPreview(): void {
    if (!selectedEmployee) {
      setValidationMessage("Выберите активный профиль сотрудника из backend registry.");
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setValidationMessage("Укажите корректный рабочий email специалиста.");
      return;
    }
    if (!reason.trim()) {
      setValidationMessage("Укажите причину создания учётной записи для журнала аудита.");
      return;
    }
    setValidationMessage(null);
    setProvisionIdempotencyKey(createIdempotencyKey());
    setPhase("preview");
  }

  function executeProvision(): void {
    setFreshMfaOpen(false);
    setPhase("executing");
    provision.mutate();
  }

  function confirmProvision(): void {
    if (!mutationReady) {
      setValidationMessage("CSRF-контекст отсутствует. Войдите заново перед изменением данных.");
      return;
    }
    if (session?.authenticationLevel === "fresh_mfa") {
      executeProvision();
      return;
    }
    setPhase("confirming");
    setFreshMfaOpen(true);
  }

  return (
    <div className="settings-screen access-settings-screen">
      <PageHeader
        eyebrow="Супер-администратор"
        title="Пользователи и специалисты"
        description="Учётные записи читаются из backend identity registry. Специалист создаётся только для существующего employee profile."
        actions={
          <button
            type="button"
            className="crm-button crm-button--primary"
            disabled={!canReadEmployees || !canProvision || !mutationReady}
            onClick={() => setDialogOpen(true)}
          >
            <IconUserPlus aria-hidden size={19} />
            Создать специалиста
          </button>
        }
      />

      {!canReadEmployees || !canProvision ? (
        <StateMessage
          state="denied"
          title="Создание специалиста недоступно"
          message="Backend не выдал одно из разрешений identity.employees.read и identity.specialists.provision."
        />
      ) : !mutationReady ? (
        <StateMessage
          state="stale"
          title="Доступен только просмотр"
          message="CSRF-контекст не восстановлен. Для создания специалиста используйте повторный вход в верхней панели."
        />
      ) : null}

      <label className="access-user-search">
        <span>Поиск пользователей</span>
        <input
          type="search"
          value={search}
          placeholder="Имя или email"
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>

      <DataTable
        caption="Пользователи CRM"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.displayName}
        state={state}
      />

      {users.isError && state === "error" ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          onClick={() => void users.refetch()}
        >
          Повторить загрузку
        </button>
      ) : null}
      {users.hasNextPage ? (
        <button
          type="button"
          className="crm-button crm-button--quiet"
          disabled={repeatedCursor || users.isFetchingNextPage}
          onClick={() => {
            if (!repeatedCursor) void users.fetchNextPage();
          }}
        >
          {users.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё пользователей"}
        </button>
      ) : null}
      {repeatedCursor ? (
        <StateMessage
          state="stale"
          title="Пагинация остановлена безопасно"
          message="Backend повторил cursor. Frontend не запрашивает одну страницу повторно."
        />
      ) : null}

      <section className="access-employee-registry" aria-labelledby="migrated-employees-heading">
        <div className="access-registry-heading">
          <div>
            <h2 id="migrated-employees-heading">Сотрудники из мигрированной БД</h2>
            <p>
              Read-only реестр активных employee profiles, для которых ещё можно создать учётную
              запись специалиста. Пустой email остаётся пустым и не подменяется тестовым адресом.
            </p>
          </div>
          <label className="access-user-search">
            <span>Поиск сотрудников</span>
            <input
              type="search"
              value={employeeSearch}
              placeholder="ФИО, email или табельный номер"
              onChange={(event) => setEmployeeSearch(event.currentTarget.value)}
            />
          </label>
        </div>

        <DataTable
          caption="Сотрудники из мигрированной БД"
          columns={employeeColumns}
          rows={employeeRows}
          getRowId={(row) => row.employeeProfileId}
          getRowLabel={(row) => row.displayName}
          state={employeeState}
          empty={
            <StateMessage
              state="empty"
              title="Нет сотрудников без учётной записи"
              message="Backend не вернул активные employee profiles, доступные для создания специалиста."
            />
          }
        />

        {employees.isError && employeeState === "error" ? (
          <StateMessage
            state="error"
            title="Сотрудники не загружены"
            message={employees.error.message}
            action={{ label: "Повторить", onPress: () => void employees.refetch() }}
          />
        ) : null}
        {employees.hasNextPage ? (
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={repeatedEmployeeCursor || employees.isFetchingNextPage}
            onClick={() => {
              if (!repeatedEmployeeCursor) void employees.fetchNextPage();
            }}
          >
            {employees.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё сотрудников"}
          </button>
        ) : null}
        {repeatedEmployeeCursor ? (
          <StateMessage
            state="stale"
            title="Пагинация сотрудников остановлена безопасно"
            message="Backend повторил cursor. Frontend не запрашивает одну страницу повторно."
          />
        ) : null}
      </section>

      <Modal
        open={dialogOpen}
        title="Создать специалиста"
        description="Выберите сотрудника из БД, проверьте данные и подтвердите операцию fresh MFA."
        dismissible={!provision.isPending}
        size="wide"
        onClose={resetProvisioning}
      >
        {phase === "receipt" && provision.data ? (
          <PreviewConfirmReceipt
            phase="receipt"
            title="Специалист создан"
            operationId={provision.data.operationId}
            receipt={{
              title: "Учётная запись специалиста создана",
              message:
                "Backend подтвердил роль SPECIALIST и связь с employee profile. Доставка приглашения поставлена во внутреннюю очередь, но ещё не подтверждена провайдером.",
              outcome: "complete",
              evidence: {
                operationId: provision.data.operationId,
                requestId: provision.data.requestId,
                receiptId: provision.data.id,
                completedAt: provision.data.occurredAt,
              },
              items: [
                {
                  id: provision.data.userId,
                  label: `Пользователь ${provision.data.userId}`,
                  outcome: `Приглашение действует до ${new Date(provision.data.expiresAt).toLocaleString("ru-RU")}; доставка: ${provision.data.credentialDelivery}`,
                },
                {
                  id: provision.data.auditEventId,
                  label: "Событие аудита",
                  outcome: provision.data.auditEventId,
                },
              ],
            }}
            onOpenReceiptTarget={resetProvisioning}
          />
        ) : (
          <PreviewConfirmReceipt
            phase={phase}
            title={selectedEmployee?.displayName ?? "Новый специалист"}
            description="Generic-приглашение не используется: продуктовая роль создаётся атомарно со связью employee profile."
            operationId="ProvisionSpecialist"
            pending={provision.isPending}
            confirmLabel="Создать специалиста"
            previewItems={
              selectedEmployee
                ? [
                    { label: "Сотрудник", after: selectedEmployee.displayName },
                    { label: "Employee profile", after: selectedEmployee.employeeProfileId },
                    { label: "Email", after: email.trim() || "Не указан" },
                    { label: "Роль CRM", after: "SPECIALIST" },
                    { label: "Причина", after: reason.trim() || "Не указана" },
                  ]
                : []
            }
            onRequestPreview={requestPreview}
            onConfirm={confirmProvision}
            onCancel={resetProvisioning}
          >
            {phase === "draft" ? (
              <div className="access-provision-form">
                <label>
                  <span>Найти сотрудника</span>
                  <input
                    type="search"
                    value={employeeSearch}
                    placeholder="ФИО, email или табельный номер"
                    onChange={(event) => setEmployeeSearch(event.currentTarget.value)}
                  />
                </label>

                {!canReadEmployees ? (
                  <StateMessage
                    compact
                    state="denied"
                    title="Сотрудники недоступны"
                    message="Backend не выдал разрешение identity.employees.read."
                  />
                ) : employees.isPending ? (
                  <StateMessage compact state="loading" title="Загружаем сотрудников из БД" />
                ) : employees.isError ? (
                  <StateMessage
                    compact
                    state={
                      employees.error instanceof ApiError && employees.error.status === 403
                        ? "denied"
                        : "error"
                    }
                    title="Сотрудники не загружены"
                    message={employees.error.message}
                    action={{ label: "Повторить", onPress: () => void employees.refetch() }}
                  />
                ) : employeeRows.length === 0 ? (
                  <StateMessage
                    compact
                    state="empty"
                    title="Нет доступных сотрудников"
                    message="Backend не нашёл активные employee profiles без учётной записи специалиста."
                  />
                ) : (
                  <fieldset className="access-employee-picker">
                    <legend>Активные профили сотрудников</legend>
                    {employeeRows.map((employee) => (
                      <label
                        className={
                          selectedEmployeeId === employee.employeeProfileId
                            ? "is-selected"
                            : undefined
                        }
                        key={employee.employeeProfileId}
                      >
                        <input
                          type="radio"
                          name="employee-profile"
                          value={employee.employeeProfileId}
                          checked={selectedEmployeeId === employee.employeeProfileId}
                          onChange={() => chooseEmployee(employee)}
                        />
                        <IconIdBadge2 aria-hidden size={20} />
                        <span>
                          <strong>{employee.displayName}</strong>
                          <small>
                            {employee.email ?? "Email не задан"}
                            {employee.employeeNumber ? ` · № ${employee.employeeNumber}` : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}

                {employees.hasNextPage ? (
                  <button
                    type="button"
                    className="crm-button crm-button--quiet"
                    disabled={repeatedEmployeeCursor || employees.isFetchingNextPage}
                    onClick={() => {
                      if (!repeatedEmployeeCursor) void employees.fetchNextPage();
                    }}
                  >
                    {employees.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё сотрудников"}
                  </button>
                ) : null}

                <div className="access-provision-fields">
                  <label>
                    <span>Рабочий email</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                    />
                  </label>
                  <label>
                    <span>Причина создания</span>
                    <textarea
                      rows={3}
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.currentTarget.value)}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </PreviewConfirmReceipt>
        )}

        {validationMessage ? (
          <StateMessage state="validation" title="Операция не готова" message={validationMessage} />
        ) : null}
        {provision.isError ? (
          <StateMessage
            state={
              provision.error instanceof ApiError && provision.error.status === 409
                ? "conflict"
                : "error"
            }
            title="Специалист не создан"
            message={provision.error.message}
          />
        ) : null}
      </Modal>

      <FreshMfaGate
        open={freshMfaOpen}
        intentLabel="Создание учётной записи специалиста"
        onCancel={() => {
          setFreshMfaOpen(false);
          setPhase("preview");
        }}
        onVerified={executeProvision}
      />
    </div>
  );
}
