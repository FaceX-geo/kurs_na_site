import { IconChartBar, IconChevronRight, IconHistory, IconRefresh } from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  createIdempotencyKey,
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
  type ReportCode,
  type ReportRunResponse,
  type ReportRunState,
  type ReportRunsResponse,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import {
  CursorPagination,
  DataTable,
  type DataTableColumn,
  type OperationPhase,
  PageHeader,
  PreviewConfirmReceipt,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import { ReportResultInspector } from "./ReportResultInspector";
import {
  buildReportRequest,
  getReportDefinition,
  isCodeFilter,
  REPORT_CODE_FILTER_PATTERN,
  REPORT_DEFINITION_BY_CODE,
  REPORT_DEFINITIONS,
  type ReportFilterValues,
  reportFilterMaxLength,
} from "./reportDefinitions";
import "./reports.css";

type ReportRun = ReportRunsResponse["items"][number];

const HISTORY_PAGE_SIZE = 25;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORT_CODE: ReportCode = "pipeline.summary";

function reportLabel(code: ReportCode): string {
  return REPORT_DEFINITION_BY_CODE.get(code)?.title ?? code;
}

function runStateLabel(state: ReportRunState): string {
  return state === "completed" ? "Готов" : "Ошибка";
}

function scopeLabel(scope: ReportRunResponse["scopeVisibility"]): string {
  const labels: Record<ReportRunResponse["scopeVisibility"], string> = {
    assigned: "Назначенные мне",
    team: "Команда",
    department: "Подразделение",
    all: "Вся CRM",
  };
  return labels[scope];
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Некорректная дата API" : parsed.toLocaleString("ru-RU");
}

function isStale(value: string): boolean {
  const timestamp = new Date(value).valueOf();
  return Number.isNaN(timestamp) || Date.now() - timestamp > STALE_AFTER_MS;
}

function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Повторите запрос. Если ошибка сохранится, передайте её администратору.";
  return error.requestId
    ? `Сервер отклонил запрос. Код запроса: ${error.requestId}.`
    : "Сервер отклонил запрос. Повторите его после проверки условий.";
}

function filterSummary(values: ReportFilterValues): string {
  const active = Object.entries(values).filter(([, value]) => value.trim());
  if (active.length === 0) return "Без дополнительных фильтров";
  return active.map(([key, value]) => `${key}: ${value.trim()}`).join("; ");
}

export function ReportsScreen() {
  const queryClient = useQueryClient();
  const [selectedCode, setSelectedCode] = useState<ReportCode>(DEFAULT_REPORT_CODE);
  const [historyCode, setHistoryCode] = useState<ReportCode | "">("");
  const [historyState, setHistoryState] = useState<ReportRunState | "">("");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<ReportFilterValues>({});
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow",
  );
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<OperationPhase>("draft");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const history = useInfiniteQuery({
    queryKey: ["crm", "report-runs", historyCode, historyState],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listReportRuns({
        limit: HISTORY_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(historyCode ? { reportCode: historyCode } : {}),
        ...(historyState ? { state: historyState } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const loadedPages = history.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);

  const detail = useQuery({
    queryKey: ["crm", "report-run", selectedRunId],
    queryFn: () => crmApi.getReportRun(selectedRunId ?? ""),
    enabled: Boolean(selectedRunId),
  });

  const build = useMutation({
    mutationFn: () => {
      if (!idempotencyKey) throw new Error("Preview отчёта не зафиксирован.");
      return crmApi.buildReport(
        buildReportRequest(selectedCode, filterValues, timezone.trim(), reason.trim()),
        idempotencyKey,
      );
    },
    onSuccess: async (run) => {
      setPhase("receipt");
      setSelectedRunId(run.id);
      await queryClient.invalidateQueries({ queryKey: ["crm", "report-runs"] });
    },
    onError: () => {
      setPhase("draft");
      setIdempotencyKey(null);
    },
  });

  const selectedDefinition = getReportDefinition(selectedCode);
  const historyStateValue = history.isPending
    ? "loading"
    : history.isError
      ? history.error instanceof ApiError && history.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";

  const columns = useMemo<readonly DataTableColumn<ReportRun>[]>(
    () => [
      {
        id: "report",
        label: "Отчёт",
        render: (row) => <strong>{reportLabel(row.reportCode)}</strong>,
      },
      { id: "publicId", label: "Номер", render: (row) => row.publicId },
      {
        id: "createdAt",
        label: "Создан",
        render: (row) => formatDate(row.createdAt),
      },
      {
        id: "state",
        label: "Статус",
        render: (row) => (
          <StatusPill
            status={row.state}
            label={runStateLabel(row.state)}
            tone={row.state === "completed" ? "success" : "danger"}
          />
        ),
      },
      { id: "scope", label: "Область", render: (row) => scopeLabel(row.scopeVisibility) },
      { id: "formula", label: "Формула", render: (row) => row.formulaVersion },
      {
        id: "fresh",
        label: "Данные на",
        render: (row) => (
          <span className={isStale(row.dataFreshAt) ? "reports-stale-value" : undefined}>
            {formatDate(row.dataFreshAt)}
          </span>
        ),
      },
    ],
    [],
  );

  function selectReport(code: ReportCode): void {
    setSelectedCode(code);
    setFilterValues({});
    setReason("");
    setPhase("draft");
    setIdempotencyKey(null);
    setValidationMessage(null);
    build.reset();
  }

  function requestPreview(): void {
    if (!timezone.trim()) {
      setValidationMessage("Укажите временную зону для воспроизводимого расчёта.");
      return;
    }
    if (timezone.trim().length > 64) {
      setValidationMessage("Временная зона не может быть длиннее 64 символов.");
      return;
    }
    if (reason.trim().length < 3) {
      setValidationMessage("Укажите причину запуска длиной не менее 3 символов.");
      return;
    }
    if (reason.trim().length > 4000) {
      setValidationMessage("Причина запуска не может быть длиннее 4000 символов.");
      return;
    }
    for (const field of selectedDefinition.filters) {
      const value = filterValues[field.key]?.trim();
      if (!value) continue;
      const maxLength = reportFilterMaxLength(field);
      if (maxLength && value.length > maxLength) {
        setValidationMessage(`Поле «${field.label}» не может быть длиннее ${maxLength} символов.`);
        return;
      }
      if (isCodeFilter(field) && !REPORT_CODE_FILTER_PATTERN.test(value)) {
        setValidationMessage(
          `Поле «${field.label}» должно начинаться с латинской буквы или цифры и содержать только A–Z, 0–9, точку, двоеточие, дефис или подчёркивание.`,
        );
        return;
      }
    }
    const dueBefore = filterValues.dueBefore?.trim();
    if (dueBefore && Number.isNaN(new Date(dueBefore).valueOf())) {
      setValidationMessage("Проверьте дату в фильтре срока.");
      return;
    }
    setValidationMessage(null);
    setIdempotencyKey(createIdempotencyKey());
    setPhase("preview");
  }

  function resetBuilder(): void {
    setPhase("draft");
    setIdempotencyKey(null);
    setValidationMessage(null);
    setReason("");
    build.reset();
  }

  const receipt = build.data
    ? {
        title: "Отчёт построен сервером",
        message: `${reportLabel(build.data.reportCode)} сохранён как ${build.data.publicId}.`,
        outcome: build.data.state === "completed" ? ("complete" as const) : ("failed" as const),
        evidence: {
          operationId: "BuildCrmReport",
          receiptId: build.data.publicId,
          completedAt: formatDate(build.data.createdAt),
        },
      }
    : null;

  return (
    <div className="reports-screen">
      <PageHeader
        eyebrow="Аналитика из сохранённых данных"
        title="Отчёты CRM"
        description="Семь серверных отчётов с фиксированной формулой, областью доступа, свежестью данных и историей запусков. Интерфейс не дорисовывает отсутствующие метрики."
        actions={
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            <IconRefresh aria-hidden size={18} />
            Обновить историю
          </button>
        }
      />

      <section className="reports-layout" aria-label="Каталог и конструктор отчёта">
        <section className="reports-catalog" aria-labelledby="reports-catalog-heading">
          <div className="reports-catalog__heading">
            <div>
              <p>Каталог</p>
              <h2 id="reports-catalog-heading">7 доступных расчётов</h2>
            </div>
            <span>Формулы — на сервере</span>
          </div>
          <ol>
            {REPORT_DEFINITIONS.map((definition) => (
              <li
                className={definition.code === selectedCode ? "is-selected" : undefined}
                key={definition.code}
              >
                <button
                  type="button"
                  aria-current={definition.code === selectedCode ? "true" : undefined}
                  onClick={() => selectReport(definition.code)}
                >
                  <span className="reports-catalog__icon">
                    <IconChartBar aria-hidden size={21} stroke={1.8} />
                  </span>
                  <span className="reports-catalog__copy">
                    <strong>{definition.title}</strong>
                    <span>{definition.description}</span>
                    <small>{definition.code}</small>
                  </span>
                  <IconChevronRight aria-hidden size={18} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="reports-builder" aria-labelledby="reports-builder-heading">
          <div className="reports-section-heading">
            <div>
              <p>Новый запуск</p>
              <h2 id="reports-builder-heading">{selectedDefinition.title}</h2>
            </div>
            <StatusPill status="server-scope" label="Область задаёт сервер" tone="work" />
          </div>

          <PreviewConfirmReceipt
            phase={phase}
            operationId="BuildCrmReport"
            title={phase === "draft" ? "Параметры отчёта" : "Проверьте запуск отчёта"}
            description="Запуск будет сохранён в истории. Preview не вызывает серверную операцию."
            confirmLabel="Построить и сохранить"
            pending={build.isPending}
            receipt={receipt}
            previewItems={[
              { label: "Отчёт", after: selectedDefinition.title },
              { label: "Временная зона", after: timezone || "Не указана" },
              { label: "Фильтры", after: filterSummary(filterValues) },
              { label: "Область", after: "Будет определена правами серверной сессии" },
              { label: "Причина", after: reason || "Не указана", tone: "attention" },
            ]}
            onRequestPreview={requestPreview}
            onConfirm={() => {
              setPhase("executing");
              build.mutate();
            }}
            {...(phase === "draft" ? {} : { onCancel: resetBuilder })}
            {...(build.data
              ? { onOpenReceiptTarget: () => setSelectedRunId(build.data?.id ?? null) }
              : {})}
          >
            {phase === "draft" ? (
              <div className="reports-builder__form">
                <div className="reports-builder__fields">
                  {selectedDefinition.filters.map((field) => (
                    <label key={field.key}>
                      <span>{field.label}</span>
                      <input
                        type={field.type ?? "text"}
                        value={filterValues[field.key] ?? ""}
                        placeholder={field.placeholder}
                        {...(reportFilterMaxLength(field)
                          ? { maxLength: reportFilterMaxLength(field) }
                          : {})}
                        {...(isCodeFilter(field)
                          ? { pattern: REPORT_CODE_FILTER_PATTERN.source }
                          : {})}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setFilterValues((current) => ({
                            ...current,
                            [field.key]: value,
                          }));
                        }}
                      />
                      {field.key === "dueBefore" ? (
                        <small>
                          Локальное время браузера будет преобразовано в ISO timestamp для API.
                        </small>
                      ) : null}
                    </label>
                  ))}
                  <label>
                    <span>Временная зона</span>
                    <input
                      type="text"
                      value={timezone}
                      placeholder="Europe/Moscow"
                      maxLength={64}
                      onChange={(event) => setTimezone(event.currentTarget.value)}
                    />
                  </label>
                </div>
                <label className="reports-builder__reason">
                  <span>Причина запуска</span>
                  <textarea
                    value={reason}
                    placeholder={`Зачем нужен расчёт по теме «${selectedDefinition.subject}»`}
                    rows={3}
                    maxLength={4000}
                    onChange={(event) => setReason(event.currentTarget.value)}
                  />
                  <small>Попадает в серверный журнал. Минимум 3 символа.</small>
                </label>
                <p className="reports-builder__hint">
                  Пустые фильтры означают всю доступную вам область. Ручной выбор чужой области не
                  поддерживается контрактом.
                </p>
              </div>
            ) : null}
          </PreviewConfirmReceipt>

          {validationMessage ? (
            <StateMessage
              state="validation"
              title="Проверьте черновик"
              message={validationMessage}
            />
          ) : null}
          {build.isError ? (
            <StateMessage
              state={
                build.error instanceof ApiError && build.error.status === 403 ? "denied" : "error"
              }
              title={
                build.error instanceof ApiError && build.error.status === 403
                  ? "Запуск отчёта запрещён"
                  : "Отчёт не построен"
              }
              message={describeApiError(build.error)}
              action={{ label: "Вернуться к черновику", onPress: resetBuilder }}
            />
          ) : null}
          {phase === "receipt" ? (
            <button type="button" className="crm-button crm-button--quiet" onClick={resetBuilder}>
              Новый запуск этого отчёта
            </button>
          ) : null}
        </section>
      </section>

      <section className="reports-history" aria-labelledby="reports-history-heading">
        <div className="reports-history__heading">
          <div>
            <p>
              <IconHistory aria-hidden size={18} /> История
            </p>
            <h2 id="reports-history-heading">Сохранённые запуски</h2>
          </div>
          <fieldset className="reports-controls">
            <legend className="crm-sr-only">Фильтры истории отчётов</legend>
            <label>
              <span>Отчёт</span>
              <select
                value={historyCode}
                onChange={(event) => {
                  setHistoryCode(event.currentTarget.value as ReportCode | "");
                  setCurrentPageIndex(0);
                  setSelectedRunId(null);
                }}
              >
                <option value="">Все отчёты</option>
                {REPORT_DEFINITIONS.map((definition) => (
                  <option value={definition.code} key={definition.code}>
                    {definition.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Статус</span>
              <select
                value={historyState}
                onChange={(event) => {
                  setHistoryState(event.currentTarget.value as ReportRunState | "");
                  setCurrentPageIndex(0);
                  setSelectedRunId(null);
                }}
              >
                <option value="">Все статусы</option>
                <option value="completed">Готов</option>
                <option value="failed">Ошибка</option>
              </select>
            </label>
          </fieldset>
        </div>

        <DataTable
          caption="История серверных запусков отчётов"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          getRowLabel={(row) => `Открыть ${reportLabel(row.reportCode)} ${row.publicId}`}
          selectedId={selectedRunId}
          onOpenRow={(row) => setSelectedRunId(row.id)}
          state={historyStateValue}
          empty={
            <StateMessage
              state="empty"
              title="Запусков по этим фильтрам нет"
              message="Измените фильтры истории или создайте отчёт через безопасный preview выше."
            />
          }
        />

        {loadedPages.length > 0 ? (
          <CursorPagination
            ariaLabel="Пагинация истории отчётов"
            loadedPageCount={loadedPages.length}
            currentPageIndex={safePageIndex}
            hasNextPage={Boolean(history.hasNextPage)}
            loadedItemCount={loadedItemCount}
            visibleItemCount={rows.length}
            isFetchingNextPage={history.isFetchingNextPage}
            repeatedCursor={repeatedCursor}
            onPageChange={setCurrentPageIndex}
            onFetchNextPage={async () => {
              if (repeatedCursor) return;
              const before = loadedPages.length;
              const result = await history.fetchNextPage();
              const after = result.data?.pages.length ?? before;
              if (after > before) setCurrentPageIndex(after - 1);
            }}
          />
        ) : null}

        {history.isFetchNextPageError && rows.length > 0 ? (
          <StateMessage
            state="error"
            title="Следующая страница не загружена"
            message={describeApiError(history.error)}
            action={{ label: "Повторить", onPress: () => void history.fetchNextPage() }}
          />
        ) : null}
        {history.isError && historyStateValue === "error" ? (
          <StateMessage
            state="error"
            title="История отчётов недоступна"
            message={describeApiError(history.error)}
            action={{ label: "Повторить", onPress: () => void history.refetch() }}
          />
        ) : null}
      </section>

      <ReportDetailPanel
        runId={selectedRunId}
        run={detail.data}
        pending={detail.isPending && Boolean(selectedRunId)}
        error={detail.error}
        onRetry={() => void detail.refetch()}
        onClose={() => setSelectedRunId(null)}
      />
    </div>
  );
}

interface ReportDetailPanelProps {
  runId: string | null;
  run: ReportRunResponse | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
}

function ReportDetailPanel({
  runId,
  run,
  pending,
  error,
  onRetry,
  onClose,
}: ReportDetailPanelProps) {
  if (!runId) {
    return (
      <section className="reports-detail reports-detail--empty" aria-label="Результат отчёта">
        <StateMessage
          state="empty"
          title="Выберите сохранённый запуск"
          message="Откройте строку истории клавишей Enter, пробелом или указателем. Детали будут повторно прочитаны через GetCrmReportRun."
        />
      </section>
    );
  }

  if (pending) {
    return (
      <section className="reports-detail" aria-label="Результат отчёта">
        <StateMessage
          state="loading"
          title="Проверяем сохранённый результат"
          message="Читаем выбранный запуск с сервера, не используя данные строки как доказательство результата."
        />
      </section>
    );
  }

  if (error || !run) {
    const denied = error instanceof ApiError && error.status === 403;
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <section className="reports-detail" aria-label="Результат отчёта">
        <StateMessage
          state={denied ? "denied" : "error"}
          title={
            denied
              ? "Результат скрыт правами"
              : missing
                ? "Запуск не найден"
                : "Результат не загружен"
          }
          message={describeApiError(error)}
          {...(denied ? {} : { action: { label: "Повторить", onPress: onRetry } })}
        />
      </section>
    );
  }

  const stale = isStale(run.dataFreshAt);

  return (
    <section className="reports-detail" aria-labelledby="reports-detail-heading">
      <header>
        <div>
          <p>{run.publicId}</p>
          <h2 id="reports-detail-heading">{reportLabel(run.reportCode)}</h2>
          <span>Создан {formatDate(run.createdAt)}</span>
        </div>
        <div className="reports-detail__actions">
          <StatusPill
            status={run.state}
            label={runStateLabel(run.state)}
            tone={run.state === "completed" ? "success" : "danger"}
          />
          <button type="button" className="crm-button crm-button--quiet" onClick={onClose}>
            Закрыть детали
          </button>
        </div>
      </header>

      <dl className="reports-provenance">
        <div>
          <dt>Версия формулы</dt>
          <dd>{run.formulaVersion}</dd>
        </div>
        <div>
          <dt>Область расчёта</dt>
          <dd>{scopeLabel(run.scopeVisibility)}</dd>
        </div>
        <div>
          <dt>Данные актуальны на</dt>
          <dd>{formatDate(run.dataFreshAt)}</dd>
        </div>
        <div>
          <dt>Исключено записей</dt>
          <dd>{run.excludedRecords.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Временная зона</dt>
          <dd>{run.timezone}</dd>
        </div>
        <div>
          <dt>Версия запуска</dt>
          <dd>{run.version}</dd>
        </div>
      </dl>

      {stale ? (
        <StateMessage
          compact
          state="stale"
          title="Снимок старше 24 часов"
          message="Это сохранённый результат, а не текущая картина. Постройте новый запуск, если нужна свежая дата."
        />
      ) : null}
      {run.state === "failed" ? (
        <StateMessage
          state="error"
          title="Сервер отметил запуск как неуспешный"
          message="Поля result ниже показаны как фактический ответ сервера и не считаются подтверждёнными KPI."
        />
      ) : null}

      <ReportFilters filters={run.filters} />
      <ReportResultInspector run={run} />
    </section>
  );
}

function ReportFilters({ filters }: { filters: Record<string, unknown> }) {
  const entries = Object.entries(filters);
  return (
    <section className="reports-applied-filters" aria-labelledby="reports-applied-filters-heading">
      <div className="reports-section-heading">
        <div>
          <p>Условия запуска</p>
          <h3 id="reports-applied-filters-heading">Применённые фильтры</h3>
        </div>
      </div>
      {entries.length === 0 ? (
        <p>Дополнительные фильтры не передавались; сервер применил разрешённую область сессии.</p>
      ) : (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{formatFilterValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function formatFilterValue(value: unknown): string {
  if (value === null) return "Нет значения";
  if (typeof value === "string") return value || "Пустая строка";
  if (typeof value === "number") return value.toLocaleString("ru-RU");
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return JSON.stringify(value) ?? "Значение отсутствует";
}
