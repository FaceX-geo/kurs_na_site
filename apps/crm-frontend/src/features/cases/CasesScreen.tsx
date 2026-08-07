import { IconLayoutKanban, IconList, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import {
  type CasesResponse,
  crmApi,
  type FunnelsResponse,
  hasRepeatedNextCursor,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { type AuthSession, hasPermission, useAuth } from "@/shared/auth";
import {
  DataTable,
  type DataTableColumn,
  KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  Modal,
  type OperationPhase,
  PageHeader,
  PreviewConfirmReceipt,
  StateMessage,
  StatusPill,
  ViewSwitcher,
} from "@/shared/ui";
import {
  type CaseTransitionDraft,
  type CaseTransitionEvidence,
  createCaseTransitionDraft,
  transitionCase,
} from "./case-transition-api";
import "@/features/cases/cases.css";

type CaseRow = CasesResponse["items"][number];
type Funnel = FunnelsResponse["items"][number];
type FunnelTransition = Funnel["transitions"][number];
type CaseView = "kanban" | "list";

interface PendingCaseTransition {
  row: CaseRow;
  targetStageCode: string;
  targetStageTitle: string;
  transition: FunnelTransition | null;
  validationMessage?: string;
  draft: CaseTransitionDraft;
}

const TONES: readonly KanbanColumn["tone"][] = [
  "new",
  "review",
  "documents",
  "selection",
  "waiting",
  "work",
  "done",
];

export function CasesScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("search") ?? "");
  const [stage, setStage] = useState(searchParams.get("stage") ?? "");
  const [pendingTransition, setPendingTransition] = useState<PendingCaseTransition | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<OperationPhase>("draft");
  const [reasonText, setReasonText] = useState("");
  const [previewValidation, setPreviewValidation] = useState<string | null>(null);
  const hasAllScope = session?.scopeVisibility === "all";
  const caseCollectionLabel = hasAllScope ? "Все заявки" : "Доступные заявки";
  const view: CaseView = searchParams.get("view") === "list" ? "list" : "kanban";
  const cases = useInfiniteQuery({
    queryKey: ["crm", "cases", { query, stage }],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      crmApi.listCases({
        limit: 200,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(query.trim() ? { search: query.trim() } : {}),
        ...(stage ? { stageCode: stage } : {}),
      }),
    getNextPageParam: nextCursorForPage,
  });
  const funnels = useQuery({
    queryKey: ["crm", "funnels"],
    queryFn: () => crmApi.listFunnels(),
  });
  const caseTransition = useMutation({
    mutationFn: transitionCase,
    onSuccess: () => {
      setTransitionPhase("receipt");
      void queryClient.invalidateQueries({ queryKey: ["crm", "cases"] });
    },
    onError: () => setTransitionPhase("preview"),
  });

  const rows = cases.data?.pages.flatMap((page) => page.items) ?? [];
  const repeatedCursor = hasRepeatedNextCursor(cases.data?.pages ?? []);
  const columns = useMemo(() => buildColumns(funnels.data?.items, rows), [funnels.data, rows]);
  const canRequestTransition =
    hasPermission(session, "crm.case.transition") || hasPermission(session, "crm.case.reopen");
  const canStartTransition = canRequestTransition && funnels.isSuccess && !caseTransition.isPending;
  const cards = useMemo<KanbanCard[]>(
    () =>
      rows.map((item) => ({
        id: item.id,
        columnId: item.stageCode,
        title: item.title,
        subtitle: item.publicId,
        badge: <StatusPill status={item.status} label={item.status} />,
        meta: [
          { label: "Следующий шаг", value: item.nextStep ?? "Не назначен" },
          { label: "Обновлено", value: new Date(item.updatedAt).toLocaleDateString("ru-RU") },
        ],
      })),
    [rows],
  );
  const tableColumns: readonly DataTableColumn<CaseRow>[] = [
    { id: "title", label: "Заявка", render: (row) => <strong>{row.title}</strong> },
    { id: "publicId", label: "Номер", render: (row) => row.publicId },
    { id: "stage", label: "Этап", render: (row) => row.stageCode },
    { id: "next", label: "Следующий шаг", render: (row) => row.nextStep ?? "Не назначен" },
    {
      id: "status",
      label: "Статус",
      render: (row) => <StatusPill status={row.status} label={row.status} />,
    },
    {
      id: "transition",
      label: "Изменить этап",
      render: (row) => {
        const availableColumns = stageOptionsForRow(row, columns, funnels.data?.items, session);
        return (
          <CaseStageControl
            row={row}
            columns={availableColumns}
            disabled={!canStartTransition || availableColumns.length < 2}
            onRequest={requestTransition}
          />
        );
      },
    },
  ];
  const hasVisibleData = rows.length > 0;
  const state = cases.isPending
    ? "loading"
    : cases.isError && !hasVisibleData
      ? cases.error instanceof ApiError && cases.error.status === 403
        ? "denied"
        : "error"
      : rows.length === 0
        ? "empty"
        : "ready";

  function changeView(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("view", next === "list" ? "list" : "kanban");
    setSearchParams(params, { replace: true });
  }

  function requestTransition(row: CaseRow, targetStageCode: string) {
    const funnel = funnels.data?.items.find(
      (item) => item.code === row.funnelCode && item.version === row.funnelVersion,
    );
    const transition =
      funnel?.transitions.find(
        (item) => item.from.includes(row.stageCode) && item.to.includes(targetStageCode),
      ) ?? null;
    const targetStageTitle =
      funnel?.states.find((item) => item.code === targetStageCode)?.title ??
      columns.find((item) => item.id === targetStageCode)?.title ??
      targetStageCode;
    let validationMessage: string | undefined;

    if (targetStageCode === row.stageCode) {
      validationMessage = "Выберите этап, отличный от текущего.";
    } else if (!funnel) {
      validationMessage =
        "Версия воронки этой заявки не загружена. Обновите справочник и повторите.";
    } else if (funnel.status !== "active") {
      validationMessage = "Backend пометил эту версию воронки как неактивную для изменений.";
    } else if (!transition) {
      validationMessage = "В выбранной версии воронки такой переход не разрешён.";
    } else if (!hasPermission(session, transition.permissionCode)) {
      validationMessage = "У текущей роли нет permission для выбранного перехода.";
    }

    setPendingTransition({
      row,
      targetStageCode,
      targetStageTitle,
      transition,
      ...(validationMessage ? { validationMessage } : {}),
      draft: createCaseTransitionDraft({
        caseId: row.id,
        expectedVersion: row.version,
        body: { toStageCode: targetStageCode },
      }),
    });
    setReasonText("");
    setPreviewValidation(null);
    setTransitionPhase("draft");
    caseTransition.reset();
  }

  function requestPreview() {
    if (!pendingTransition || pendingTransition.validationMessage) return;
    if (pendingTransition.transition?.reasonRequired && !reasonText.trim()) {
      setPreviewValidation("Для этого перехода укажите причину.");
      return;
    }
    setPreviewValidation(null);
    setTransitionPhase("preview");
  }

  function confirmTransition() {
    if (!pendingTransition || pendingTransition.validationMessage) return;
    const normalizedReason = reasonText.trim();
    setTransitionPhase("executing");
    caseTransition.mutate({
      ...pendingTransition.draft,
      body: {
        ...pendingTransition.draft.body,
        ...(normalizedReason ? { reasonText: normalizedReason } : {}),
      },
    });
  }

  function closeTransition() {
    if (caseTransition.isPending) return;
    setPendingTransition(null);
    setPreviewValidation(null);
    setReasonText("");
    setTransitionPhase("draft");
    caseTransition.reset();
  }

  function refreshAfterConflict() {
    closeTransition();
    void cases.refetch();
  }

  return (
    <div className="cases-screen">
      <PageHeader
        title={hasAllScope ? "Все заявки и воронки" : "Доступные заявки и воронки"}
        description={
          hasAllScope
            ? "Backend подтвердил scope all и вернул полный разрешённый реестр CRM. Frontend не расширяет выборку и не восстанавливает скрытые итоги."
            : "Список уже ограничен backend effective scope. Frontend не расширяет выборку и не восстанавливает скрытые итоги."
        }
      />

      <div className="cases-toolbar">
        <ViewSwitcher
          value={view}
          options={[
            { value: "kanban", label: "Канбан", icon: <IconLayoutKanban aria-hidden size={17} /> },
            { value: "list", label: "Список", icon: <IconList aria-hidden size={17} /> },
          ]}
          onChange={changeView}
        />
        <label className="cases-search">
          <span className="sr-only">Найти заявку в разрешённом реестре</span>
          <IconSearch aria-hidden size={18} />
          <input
            type="search"
            placeholder="Номер или имя"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          <span className="sr-only">Этап</span>
          <select value={stage} onChange={(event) => setStage(event.currentTarget.value)}>
            <option value="">Все разрешённые этапы</option>
            {columns.map((column) => (
              <option value={column.id} key={column.id}>
                {column.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {funnels.isError ? (
        <StateMessage
          state="stale"
          title="Справочник воронки временно недоступен"
          message="Список заявок остаётся доступен; названия этапов показаны по кодам backend."
        />
      ) : null}

      {view === "kanban" ? (
        state === "ready" ? (
          <KanbanBoard
            ariaLabel={caseCollectionLabel}
            columns={columns}
            cards={cards}
            onOpenCard={(card) => navigate(CRM_PATHS.case(card.id))}
            selectedId={pendingTransition?.row.id ?? null}
            {...(canStartTransition
              ? {
                  onMoveRequest: ({
                    card,
                    targetColumnId,
                  }: {
                    card: KanbanCard;
                    targetColumnId: string;
                  }) => {
                    const row = rows.find((item) => item.id === card.id);
                    if (row) requestTransition(row, targetColumnId);
                  },
                }
              : {})}
          />
        ) : (
          <StateMessage
            state={state}
            title={
              state === "denied"
                ? "Нет доступа к заявкам"
                : state === "error"
                  ? "Не удалось загрузить заявки"
                  : state === "loading"
                    ? "Загружаем заявки"
                    : hasAllScope
                      ? "Заявок в CRM нет"
                      : "Доступных заявок нет"
            }
            {...(cases.isError ? { message: cases.error.message } : {})}
            {...(state === "error"
              ? { action: { label: "Повторить", onPress: () => void cases.refetch() } }
              : {})}
          />
        )
      ) : (
        <DataTable
          caption={caseCollectionLabel}
          columns={tableColumns}
          rows={rows}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.title}
          onOpenRow={(row) => navigate(CRM_PATHS.case(row.id))}
          state={state}
        />
      )}

      {cases.hasNextPage ? (
        <div className="cases-pagination" aria-live="polite">
          <span>Загружено заявок: {rows.length}</span>
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={repeatedCursor || cases.isFetchingNextPage}
            onClick={() => {
              if (!repeatedCursor) void cases.fetchNextPage();
            }}
          >
            {cases.isFetchingNextPage ? "Загружаем…" : "Загрузить ещё заявки"}
          </button>
        </div>
      ) : null}
      {repeatedCursor ? (
        <StateMessage
          state="stale"
          title="Пагинация остановлена безопасно"
          message="Backend повторил cursor. Frontend не запрашивает ту же страницу повторно."
        />
      ) : null}
      {cases.isFetchNextPageError && hasVisibleData ? (
        <StateMessage
          state="error"
          title="Следующая страница не загружена"
          message={cases.error.message}
          action={{ label: "Повторить", onPress: () => void cases.fetchNextPage() }}
        />
      ) : null}

      <Modal
        open={pendingTransition !== null}
        title="Изменение этапа заявки"
        description="Сначала проверьте черновик, затем отдельно подтвердите серверную операцию."
        dismissible={!caseTransition.isPending}
        onClose={closeTransition}
      >
        {pendingTransition ? (
          <>
            <PreviewConfirmReceipt
              phase={transitionPhase}
              title={pendingTransition.row.title}
              description={`Заявка ${pendingTransition.row.publicId}`}
              operationId="TransitionCase"
              previewItems={buildTransitionPreviewItems(
                pendingTransition,
                reasonText,
                caseTransition.data,
              )}
              pending={caseTransition.isPending}
              receipt={buildTransitionReceipt(
                transitionPhase,
                caseTransition.data,
                pendingTransition,
              )}
              confirmLabel={
                caseTransition.isError && isRetryableTransitionError(caseTransition.error)
                  ? "Повторить тот же запрос"
                  : "Подтвердить изменение этапа"
              }
              {...(pendingTransition.validationMessage ? {} : { onRequestPreview: requestPreview })}
              {...(pendingTransition.validationMessage ||
              transitionPhase === "receipt" ||
              (caseTransition.isError && !isRetryableTransitionError(caseTransition.error))
                ? {}
                : { onConfirm: confirmTransition })}
              {...(transitionPhase === "receipt" ? {} : { onCancel: closeTransition })}
              {...(transitionPhase === "receipt" && caseTransition.data
                ? {
                    onOpenReceiptTarget: () =>
                      navigate(CRM_PATHS.case(caseTransition.data.case.id)),
                  }
                : {})}
            >
              {transitionPhase === "draft" && pendingTransition.transition?.reasonRequired ? (
                <label className="cases-transition-reason">
                  <span>Причина перехода</span>
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={reasonText}
                    aria-invalid={previewValidation ? "true" : undefined}
                    onChange={(event) => {
                      setReasonText(event.currentTarget.value);
                      setPreviewValidation(null);
                    }}
                  />
                </label>
              ) : null}
            </PreviewConfirmReceipt>
            {pendingTransition.validationMessage ? (
              <StateMessage
                state={
                  pendingTransition.validationMessage.includes("permission")
                    ? "denied"
                    : "validation"
                }
                title="Переход недоступен"
                message={pendingTransition.validationMessage}
              />
            ) : null}
            {previewValidation ? (
              <StateMessage
                state="validation"
                title="Черновик не готов"
                message={previewValidation}
              />
            ) : null}
            {caseTransition.isError ? (
              <TransitionError error={caseTransition.error} onConflict={refreshAfterConflict} />
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function buildColumns(
  funnels: readonly Funnel[] | undefined,
  rows: readonly CaseRow[],
): KanbanColumn[] {
  const rowFunnels = new Set(rows.map((row) => `${row.funnelCode}:${row.funnelVersion}`));
  const stateByCode = new Map<string, { code: string; title: string; order: number }>();
  for (const funnel of funnels ?? []) {
    if (!rowFunnels.has(`${funnel.code}:${funnel.version}`)) continue;
    for (const state of funnel.states) {
      const existing = stateByCode.get(state.code);
      if (!existing || state.order < existing.order) stateByCode.set(state.code, state);
    }
  }
  for (const row of rows) {
    if (!stateByCode.has(row.stageCode)) {
      stateByCode.set(row.stageCode, { code: row.stageCode, title: row.stageCode, order: 10_000 });
    }
  }

  return [...stateByCode.values()]
    .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
    .map((state, index) => ({
      id: state.code,
      title: state.title,
      tone: TONES[index % TONES.length] ?? "work",
    }));
}

function CaseStageControl({
  row,
  columns,
  disabled,
  onRequest,
}: {
  row: CaseRow;
  columns: readonly KanbanColumn[];
  disabled: boolean;
  onRequest: (row: CaseRow, targetStageCode: string) => void;
}) {
  return (
    <select
      className="cases-stage-control"
      aria-label={`Изменить этап заявки ${row.publicId} через preview`}
      value={row.stageCode}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onRequest(row, event.currentTarget.value);
      }}
    >
      {columns.map((column) => (
        <option value={column.id} key={column.id}>
          {column.title}
        </option>
      ))}
    </select>
  );
}

function stageOptionsForRow(
  row: CaseRow,
  columns: readonly KanbanColumn[],
  funnels: readonly Funnel[] | undefined,
  session: AuthSession | null,
): readonly KanbanColumn[] {
  const funnel = funnels?.find(
    (item) => item.code === row.funnelCode && item.version === row.funnelVersion,
  );
  const allowedCodes = new Set([row.stageCode]);
  for (const transition of funnel?.transitions ?? []) {
    if (
      !transition.from.includes(row.stageCode) ||
      !hasPermission(session, transition.permissionCode)
    ) {
      continue;
    }
    for (const target of transition.to) allowedCodes.add(target);
  }
  return columns.filter((column) => allowedCodes.has(column.id));
}

function buildTransitionPreviewItems(
  pending: PendingCaseTransition,
  reasonText: string,
  evidence?: CaseTransitionEvidence,
) {
  const requiredFields = pending.transition?.requiredFields ?? [];
  return [
    {
      label: "Этап",
      before: pending.row.stageCode,
      after: evidence?.case.stageCode ?? pending.targetStageTitle,
      tone: "attention" as const,
    },
    {
      label: "Версия заявки",
      before: pending.row.version,
      after: evidence?.case.version ?? `${pending.row.version} → проверит backend`,
    },
    ...(requiredFields.length > 0
      ? [{ label: "Поля, проверяемые backend", after: requiredFields.join(", ") }]
      : []),
    ...(reasonText.trim() ? [{ label: "Причина", after: reasonText.trim() }] : []),
  ];
}

function buildTransitionReceipt(
  phase: OperationPhase,
  evidence: CaseTransitionEvidence | undefined,
  pending: PendingCaseTransition,
) {
  if (phase !== "receipt" || !evidence) return null;
  return {
    title: "Этап изменён",
    message: `Backend вернул заявку ${evidence.case.publicId} в версии ${evidence.case.version}.`,
    outcome: "complete" as const,
    evidence: {
      operationId: "TransitionCase",
      requestId: evidence.receipt.requestId,
      receiptId: evidence.receipt.id,
      completedAt: evidence.receipt.occurredAt,
    },
    items: [
      {
        id: evidence.case.id,
        label: pending.row.title,
        outcome: `${evidence.case.stageCode}, версия ${evidence.case.version}`,
      },
      {
        id: evidence.receipt.auditEventId,
        label: "Событие аудита",
        outcome: evidence.receipt.auditEventId,
      },
      {
        id: `${evidence.receipt.id}:etag`,
        label: "Версия ETag",
        outcome: evidence.etag,
      },
      ...(evidence.idempotencyReplayed
        ? [
            {
              id: `${evidence.receipt.id}:replay`,
              label: "Повтор запроса",
              outcome: "Backend вернул сохранённый результат",
            },
          ]
        : []),
    ],
  };
}

function TransitionError({ error, onConflict }: { error: Error; onConflict: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const contractMismatch = apiError?.code === "TRANSITION_RECEIPT_CONTRACT_MISMATCH";
  const conflict = apiError?.status === 409 || apiError?.status === 412 || contractMismatch;
  const denied =
    apiError?.status === 401 || apiError?.status === 403 || apiError?.code === "CSRF_TOKEN_MISSING";
  const validation =
    apiError?.status === 422 ||
    apiError?.status === 428 ||
    apiError?.code === "INVALID_IDEMPOTENCY_KEY";
  return (
    <StateMessage
      state={conflict ? "conflict" : denied ? "denied" : validation ? "validation" : "error"}
      title={
        conflict
          ? contractMismatch
            ? "Подтверждение backend не прошло проверку"
            : "Заявка изменилась"
          : denied
            ? "Backend отклонил изменение"
            : validation
              ? "Переход не прошёл проверку"
              : "Этап не изменён"
      }
      message={error.message}
      {...(conflict ? { action: { label: "Обновить и начать заново", onPress: onConflict } } : {})}
    />
  );
}

function isRetryableTransitionError(error: Error): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.code === "NETWORK_ERROR" || (error.status !== undefined && error.status >= 500);
}
