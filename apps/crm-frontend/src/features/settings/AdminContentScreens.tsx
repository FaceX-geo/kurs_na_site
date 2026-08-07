import { IconArchive, IconEdit, IconPlus, IconSend } from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type ReactNode, type SetStateAction, useState } from "react";
import { useSearchParams } from "react-router";
import {
  type AdminContentQuery,
  type AdminStory,
  type AdminVacancy,
  type CreateStoryRequest,
  type CreateVacancyRequest,
  createIdempotencyKey,
  crmApi,
  hasRepeatedNextCursor,
  nextCursorForPage,
} from "@/shared/api";
import { ApiError } from "@/shared/api/errors";
import { FreshMfaGate, hasPermission, useAuth } from "@/shared/auth";
import {
  CursorPagination,
  DataTable,
  type DataTableColumn,
  Modal,
  type OperationPhase,
  PageHeader,
  PreviewConfirmReceipt,
  type PreviewItem,
  StateMessage,
  StatusPill,
} from "@/shared/ui";
import "./settings.css";

type ContentState = "draft" | "published" | "archived";

interface ContentRecord {
  id: string;
  publicId: string;
  state: ContentState;
  version: number;
  updatedAt: string;
}

interface DraftWithReason {
  reason: string;
}

interface ContentPage<T> {
  items: T[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
}

type ContentIntent<T, B> =
  | { kind: "create"; body: B; idempotencyKey: string }
  | { kind: "update"; item: T; body: B; idempotencyKey: string }
  | { kind: "publish" | "archive"; item: T; reason: string; idempotencyKey: string };

type DialogState<T> = { kind: "editor"; item: T | null } | { kind: "publish" | "archive"; item: T };

interface ValidationResult<B> {
  body?: B;
  error?: string;
}

interface ContentScreenConfig<T extends ContentRecord, D extends DraftWithReason, B> {
  kind: "vacancy" | "story";
  title: string;
  description: string;
  createLabel: string;
  readPermission: string;
  managePermission: string;
  queryKey: readonly string[];
  operations: {
    list: string;
    create: string;
    update: string;
    publish: string;
    archive: string;
  };
  emptyDraft(): D;
  toDraft(item: T): D;
  validate(draft: D): ValidationResult<B>;
  previewItems(draft: D, item: T | null): readonly PreviewItem[];
  renderForm(draft: D, setDraft: Dispatch<SetStateAction<D>>): ReactNode;
  primaryColumns: readonly DataTableColumn<T>[];
  list(query: AdminContentQuery): Promise<ContentPage<T>>;
  create(body: B, idempotencyKey: string): Promise<T>;
  update(item: T, body: B, idempotencyKey: string): Promise<T>;
  publish(item: T, reason: string, idempotencyKey: string): Promise<T>;
  archive(item: T, reason: string, idempotencyKey: string): Promise<T>;
  recordLabel(item: T): string;
}

function stateLabel(state: ContentState): string {
  if (state === "draft") return "Черновик";
  if (state === "published") return "Опубликовано";
  return "Архив";
}

function stateTone(state: ContentState): "neutral" | "success" | "attention" {
  if (state === "published") return "success";
  if (state === "archived") return "attention";
  return "neutral";
}

function isContentState(value: string | null): value is ContentState {
  return value === "draft" || value === "published" || value === "archived";
}

function errorState(error: Error): "conflict" | "denied" | "error" {
  if (error instanceof ApiError && error.status === 409) return "conflict";
  if (error instanceof ApiError && error.status === 403) return "denied";
  return "error";
}

function AdminContentScreen<T extends ContentRecord, D extends DraftWithReason, B>({
  config,
}: {
  config: ContentScreenConfig<T, D, B>;
}) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const stateParam = searchParams.get("state");
  const stateFilter: ContentState | "all" = isContentState(stateParam) ? stateParam : "all";
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [dialog, setDialog] = useState<DialogState<T> | null>(null);
  const [draft, setDraft] = useState<D>(() => config.emptyDraft());
  const [phase, setPhase] = useState<OperationPhase>("draft");
  const [intent, setIntent] = useState<ContentIntent<T, B> | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [freshMfaOpen, setFreshMfaOpen] = useState(false);
  const canRead = hasPermission(session, config.readPermission);
  const canManage = hasPermission(session, config.managePermission);
  const mutationReady = session?.mutationAccess === "ready";

  const content = useInfiniteQuery({
    queryKey: [...config.queryKey, stateFilter],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      config.list({
        limit: 100,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(stateFilter === "all" ? {} : { state: stateFilter }),
      }),
    getNextPageParam: nextCursorForPage,
    enabled: canRead,
  });
  const loadedPages = content.data?.pages ?? [];
  const safePageIndex = Math.min(currentPageIndex, Math.max(loadedPages.length - 1, 0));
  const rows = loadedPages[safePageIndex]?.items ?? [];
  const loadedItemCount = loadedPages.reduce((total, page) => total + page.items.length, 0);
  const repeatedCursor = hasRepeatedNextCursor(loadedPages);
  const tableState = !canRead
    ? "denied"
    : content.isPending
      ? "loading"
      : content.isError && loadedPages.length === 0
        ? content.error instanceof ApiError && content.error.status === 403
          ? "denied"
          : "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  const mutation = useMutation({
    mutationFn: async (nextIntent: ContentIntent<T, B>) => {
      switch (nextIntent.kind) {
        case "create":
          return config.create(nextIntent.body, nextIntent.idempotencyKey);
        case "update":
          return config.update(nextIntent.item, nextIntent.body, nextIntent.idempotencyKey);
        case "publish":
          return config.publish(nextIntent.item, nextIntent.reason, nextIntent.idempotencyKey);
        case "archive":
          return config.archive(nextIntent.item, nextIntent.reason, nextIntent.idempotencyKey);
      }
    },
    onSuccess: async () => {
      setPhase("receipt");
      await queryClient.invalidateQueries({ queryKey: config.queryKey });
    },
    onError: () => setPhase("preview"),
  });

  const columns: readonly DataTableColumn<T>[] = [
    ...config.primaryColumns,
    {
      id: "public-id",
      label: "Public ID",
      render: (row) => row.publicId,
    },
    {
      id: "state",
      label: "Статус",
      render: (row) => (
        <StatusPill status={row.state} label={stateLabel(row.state)} tone={stateTone(row.state)} />
      ),
    },
    { id: "version", label: "Версия", render: (row) => `v${row.version}` },
    {
      id: "actions",
      label: "Действия",
      render: (row) => (
        <div className="admin-content-actions">
          <button
            type="button"
            className="crm-button crm-button--quiet"
            disabled={!canManage || !mutationReady}
            onClick={() => openEditor(row)}
          >
            <IconEdit aria-hidden size={17} />
            Изменить
          </button>
          {row.state !== "published" ? (
            <button
              type="button"
              className="crm-button crm-button--quiet"
              disabled={!canManage || !mutationReady}
              onClick={() => openStateDialog("publish", row)}
            >
              <IconSend aria-hidden size={17} />
              Опубликовать
            </button>
          ) : null}
          {row.state !== "archived" ? (
            <button
              type="button"
              className="crm-button crm-button--quiet"
              disabled={!canManage || !mutationReady}
              onClick={() => openStateDialog("archive", row)}
            >
              <IconArchive aria-hidden size={17} />В архив
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  function resetOperation(): void {
    setDialog(null);
    setFreshMfaOpen(false);
    setDraft(config.emptyDraft());
    setPhase("draft");
    setIntent(null);
    setValidationMessage(null);
    mutation.reset();
  }

  function changeStateFilter(nextState: ContentState | "all"): void {
    const params = new URLSearchParams(searchParams);
    if (nextState === "all") params.delete("state");
    else params.set("state", nextState);
    setCurrentPageIndex(0);
    setSearchParams(params, { replace: true });
  }

  function openCreate(): void {
    setDialog({ kind: "editor", item: null });
    setDraft(config.emptyDraft());
    setPhase("draft");
    setIntent(null);
    setValidationMessage(null);
    mutation.reset();
  }

  function openEditor(item: T): void {
    setDialog({ kind: "editor", item });
    setDraft(config.toDraft(item));
    setPhase("draft");
    setIntent(null);
    setValidationMessage(null);
    mutation.reset();
  }

  function openStateDialog(kind: "publish" | "archive", item: T): void {
    setDialog({ kind, item });
    setDraft(config.emptyDraft());
    setPhase("draft");
    setIntent(null);
    setValidationMessage(null);
    mutation.reset();
  }

  function requestPreview(): void {
    if (!dialog) return;
    if (dialog.kind === "editor") {
      const validated = config.validate(draft);
      if (!validated.body) {
        setValidationMessage(validated.error ?? "Заполните обязательные поля.");
        return;
      }
      setIntent(
        dialog.item
          ? {
              kind: "update",
              item: dialog.item,
              body: validated.body,
              idempotencyKey: createIdempotencyKey(),
            }
          : {
              kind: "create",
              body: validated.body,
              idempotencyKey: createIdempotencyKey(),
            },
      );
    } else {
      if (!draft.reason.trim()) {
        setValidationMessage("Укажите причину для журнала аудита.");
        return;
      }
      setIntent({
        kind: dialog.kind,
        item: dialog.item,
        reason: draft.reason.trim(),
        idempotencyKey: createIdempotencyKey(),
      });
    }
    setValidationMessage(null);
    setPhase("preview");
  }

  function executeIntent(): void {
    if (!intent) return;
    setFreshMfaOpen(false);
    setPhase("executing");
    mutation.mutate(intent);
  }

  function confirmIntent(): void {
    if (!mutationReady) {
      setValidationMessage("CSRF-контекст отсутствует. Войдите заново перед изменением данных.");
      return;
    }
    if (session?.authenticationLevel === "fresh_mfa") {
      executeIntent();
    } else {
      setPhase("confirming");
      setFreshMfaOpen(true);
    }
  }

  const selectedRecord = dialog?.item ?? null;
  const operationId = intent
    ? config.operations[intent.kind]
    : dialog?.kind === "editor"
      ? dialog.item
        ? config.operations.update
        : config.operations.create
      : dialog
        ? config.operations[dialog.kind]
        : config.operations.list;
  const previewItems: readonly PreviewItem[] =
    dialog?.kind === "editor"
      ? config.previewItems(draft, dialog.item)
      : dialog
        ? [
            { label: "Материал", after: config.recordLabel(dialog.item) },
            { label: "Текущий статус", after: stateLabel(dialog.item.state) },
            {
              label: "Новый статус",
              after: dialog.kind === "publish" ? "Опубликовано" : "Архив",
            },
            { label: "Причина", after: draft.reason.trim() || "Не указана" },
          ]
        : [];

  return (
    <div className="settings-screen admin-content-screen">
      <PageHeader
        eyebrow="Контент лендинга"
        title={config.title}
        description={config.description}
        actions={
          <button
            type="button"
            className="crm-button crm-button--primary"
            disabled={!canManage || !mutationReady}
            onClick={openCreate}
          >
            <IconPlus aria-hidden size={19} />
            {config.createLabel}
          </button>
        }
      />

      {!canRead ? (
        <StateMessage
          state="denied"
          title="Контент недоступен"
          message={`Backend не выдал разрешение ${config.readPermission}.`}
        />
      ) : !canManage ? (
        <StateMessage
          state="stale"
          title="Доступен только просмотр"
          message={`Для изменений требуется ${config.managePermission}.`}
        />
      ) : !mutationReady ? (
        <StateMessage
          state="stale"
          title="Доступен только просмотр"
          message="CSRF-контекст не восстановлен. Выполните повторный вход для изменений."
        />
      ) : null}

      <label className="admin-content-filter">
        <span>Статус материала</span>
        <select
          value={stateFilter}
          onChange={(event) => changeStateFilter(event.currentTarget.value as ContentState | "all")}
        >
          <option value="all">Все статусы</option>
          <option value="draft">Черновики</option>
          <option value="published">Опубликованные</option>
          <option value="archived">Архив</option>
        </select>
      </label>

      <DataTable
        caption={config.title}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        getRowLabel={config.recordLabel}
        state={tableState}
      />
      {content.isError && tableState === "error" ? (
        <StateMessage
          state="error"
          title="Материалы не загружены"
          message={content.error.message}
          action={{ label: "Повторить", onPress: () => void content.refetch() }}
        />
      ) : null}
      {loadedPages.length > 0 ? (
        <CursorPagination
          ariaLabel={`Пагинация: ${config.title}`}
          loadedPageCount={loadedPages.length}
          currentPageIndex={safePageIndex}
          hasNextPage={Boolean(content.hasNextPage)}
          loadedItemCount={loadedItemCount}
          visibleItemCount={rows.length}
          isFetchingNextPage={content.isFetchingNextPage}
          repeatedCursor={repeatedCursor}
          onPageChange={setCurrentPageIndex}
          onFetchNextPage={async () => {
            if (repeatedCursor) return;
            const before = loadedPages.length;
            const result = await content.fetchNextPage();
            const after = result.data?.pages.length ?? before;
            if (after > before) setCurrentPageIndex(after - 1);
          }}
        />
      ) : null}
      {content.isFetchNextPageError && rows.length > 0 ? (
        <StateMessage
          state="error"
          title="Следующая страница материалов не загружена"
          message={content.error.message}
          action={{ label: "Повторить", onPress: () => void content.fetchNextPage() }}
        />
      ) : null}

      <Modal
        open={dialog !== null}
        title={
          dialog?.kind === "publish"
            ? "Опубликовать материал"
            : dialog?.kind === "archive"
              ? "Архивировать материал"
              : selectedRecord
                ? "Изменить материал"
                : config.createLabel
        }
        description="Сохранение, публикация и архивация подтверждаются backend по версии записи и fresh MFA."
        dismissible={!mutation.isPending}
        size="wide"
        onClose={resetOperation}
      >
        {phase === "receipt" && mutation.data ? (
          <PreviewConfirmReceipt
            phase="receipt"
            title={config.recordLabel(mutation.data)}
            operationId={operationId}
            receipt={{
              title: "Изменение подтверждено",
              message: `Backend вернул запись ${mutation.data.publicId}, статус — ${stateLabel(mutation.data.state)}.`,
              outcome: "complete",
              evidence: { operationId, completedAt: mutation.data.updatedAt },
              items: [
                {
                  id: mutation.data.id,
                  label: config.recordLabel(mutation.data),
                  outcome: `Версия ${mutation.data.version}`,
                },
              ],
            }}
            onOpenReceiptTarget={resetOperation}
          />
        ) : (
          <PreviewConfirmReceipt
            phase={phase}
            title={selectedRecord ? config.recordLabel(selectedRecord) : config.createLabel}
            description="Перед выполнением сравните материал и зафиксируйте причину для аудита."
            operationId={operationId}
            previewItems={previewItems}
            pending={mutation.isPending}
            confirmLabel={
              dialog?.kind === "publish"
                ? "Опубликовать"
                : dialog?.kind === "archive"
                  ? "Переместить в архив"
                  : selectedRecord
                    ? "Сохранить изменения"
                    : "Создать черновик"
            }
            onRequestPreview={requestPreview}
            {...(intent ? { onConfirm: confirmIntent } : {})}
            onCancel={resetOperation}
          >
            {phase === "draft" && dialog?.kind === "editor"
              ? config.renderForm(draft, setDraft)
              : null}
            {phase === "draft" && dialog && dialog.kind !== "editor" ? (
              <label className="admin-content-reason">
                <span>Причина изменения статуса</span>
                <textarea
                  rows={4}
                  maxLength={1000}
                  required
                  value={draft.reason}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, reason: event.currentTarget.value }))
                  }
                />
              </label>
            ) : null}
          </PreviewConfirmReceipt>
        )}

        {validationMessage ? (
          <StateMessage state="validation" title="Черновик не готов" message={validationMessage} />
        ) : null}
        {mutation.isError ? (
          <StateMessage
            state={errorState(mutation.error)}
            title="Изменение не выполнено"
            message={mutation.error.message}
            {...(mutation.error instanceof ApiError && mutation.error.status === 403
              ? {
                  action: {
                    label: "Подтвердить MFA повторно",
                    onPress: () => {
                      setPhase("confirming");
                      setFreshMfaOpen(true);
                    },
                  },
                }
              : {})}
          />
        ) : null}
      </Modal>

      <FreshMfaGate
        open={freshMfaOpen}
        intentLabel={`${operationId}: изменение контента лендинга`}
        onCancel={() => {
          setFreshMfaOpen(false);
          setPhase("preview");
        }}
        onVerified={executeIntent}
      />
    </div>
  );
}

interface VacancyDraft extends DraftWithReason {
  publicId: string;
  sector: AdminVacancy["sector"];
  title: string;
  city: string;
  employer: string;
  salaryText: string;
  summary: string;
  responsibilities: string;
  requirements: string;
  conditions: string;
  applicantType: AdminVacancy["applicantType"];
  sphere: string;
}

function emptyVacancyDraft(): VacancyDraft {
  return {
    publicId: "",
    sector: "industry",
    title: "",
    city: "",
    employer: "",
    salaryText: "",
    summary: "",
    responsibilities: "",
    requirements: "",
    conditions: "",
    applicantType: "relocation",
    sphere: "",
    reason: "",
  };
}

function vacancyToDraft(item: AdminVacancy): VacancyDraft {
  return {
    publicId: item.publicId,
    sector: item.sector,
    title: item.title,
    city: item.city,
    employer: item.employer,
    salaryText: item.salaryText,
    summary: item.summary,
    responsibilities: item.responsibilities.join("\n"),
    requirements: item.requirements.join("\n"),
    conditions: item.conditions.join("\n"),
    applicantType: item.applicantType,
    sphere: item.sphere,
    reason: "",
  };
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitTags(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateVacancy(draft: VacancyDraft): ValidationResult<CreateVacancyRequest> {
  const missing = [
    draft.title,
    draft.city,
    draft.employer,
    draft.salaryText,
    draft.summary,
    draft.sphere,
    draft.reason,
  ].some((value) => !value.trim());
  const responsibilities = splitLines(draft.responsibilities);
  const requirements = splitLines(draft.requirements);
  const conditions = splitLines(draft.conditions);
  if (missing || !responsibilities.length || !requirements.length || !conditions.length) {
    return {
      error:
        "Заполните название, город, работодателя, зарплату, описание, сферу, причину и минимум по одному пункту каждого списка.",
    };
  }
  return {
    body: {
      ...(draft.publicId.trim() ? { publicId: draft.publicId.trim() } : {}),
      sector: draft.sector,
      title: draft.title.trim(),
      city: draft.city.trim(),
      employer: draft.employer.trim(),
      salaryText: draft.salaryText.trim(),
      summary: draft.summary.trim(),
      responsibilities,
      requirements,
      conditions,
      applicantType: draft.applicantType,
      sphere: draft.sphere.trim(),
      reason: draft.reason.trim(),
    },
  };
}

function VacancyForm({
  draft,
  setDraft,
}: {
  draft: VacancyDraft;
  setDraft: Dispatch<SetStateAction<VacancyDraft>>;
}) {
  const update = <K extends keyof VacancyDraft>(key: K, value: VacancyDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="admin-content-form">
      <div className="admin-content-form__grid">
        <label>
          <span>Название вакансии</span>
          <input
            value={draft.title}
            required
            onChange={(event) => update("title", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Public ID (необязательно)</span>
          <input
            value={draft.publicId}
            onChange={(event) => update("publicId", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Город</span>
          <input
            value={draft.city}
            required
            onChange={(event) => update("city", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Работодатель</span>
          <input
            value={draft.employer}
            required
            onChange={(event) => update("employer", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Зарплата</span>
          <input
            value={draft.salaryText}
            required
            onChange={(event) => update("salaryText", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Сфера</span>
          <input
            value={draft.sphere}
            required
            onChange={(event) => update("sphere", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Сектор</span>
          <select
            value={draft.sector}
            onChange={(event) =>
              update("sector", event.currentTarget.value as VacancyDraft["sector"])
            }
          >
            <option value="industry">Промышленность</option>
            <option value="medicine">Медицина</option>
            <option value="education">Образование</option>
            <option value="port">Порт</option>
            <option value="safety">Безопасность</option>
            <option value="students">Студенты</option>
          </select>
        </label>
        <label>
          <span>Тип заявителя</span>
          <select
            value={draft.applicantType}
            onChange={(event) =>
              update("applicantType", event.currentTarget.value as VacancyDraft["applicantType"])
            }
          >
            <option value="relocation">Переезд</option>
            <option value="student">Студент</option>
          </select>
        </label>
      </div>
      <label>
        <span>Краткое описание</span>
        <textarea
          rows={4}
          value={draft.summary}
          required
          onChange={(event) => update("summary", event.currentTarget.value)}
        />
      </label>
      <div className="admin-content-form__lists">
        <label>
          <span>Обязанности — по одной на строку</span>
          <textarea
            rows={6}
            value={draft.responsibilities}
            required
            onChange={(event) => update("responsibilities", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Требования — по одному на строку</span>
          <textarea
            rows={6}
            value={draft.requirements}
            required
            onChange={(event) => update("requirements", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Условия — по одному на строку</span>
          <textarea
            rows={6}
            value={draft.conditions}
            required
            onChange={(event) => update("conditions", event.currentTarget.value)}
          />
        </label>
      </div>
      <label>
        <span>Причина изменения</span>
        <textarea
          rows={3}
          value={draft.reason}
          required
          maxLength={1000}
          onChange={(event) => update("reason", event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

interface StoryDraft extends DraftWithReason {
  publicId: string;
  tone: AdminStory["tone"];
  filters: string;
  cardTags: string;
  ariaLabel: string;
  eyebrow: string;
  title: string;
  person: string;
  route: string;
  avatar: string;
  avatarAlt: string;
  cardQuote: string;
  quote: string;
  tags: string;
  lead: string;
  gallery: string;
  steps: string;
}

function emptyStoryDraft(): StoryDraft {
  return {
    publicId: "",
    tone: "berry",
    filters: "",
    cardTags: "",
    ariaLabel: "",
    eyebrow: "",
    title: "",
    person: "",
    route: "",
    avatar: "",
    avatarAlt: "",
    cardQuote: "",
    quote: "",
    tags: "",
    lead: "",
    gallery: "",
    steps: "",
    reason: "",
  };
}

function storyToDraft(item: AdminStory): StoryDraft {
  return {
    publicId: item.publicId,
    tone: item.tone,
    filters: item.filters.join(", "),
    cardTags: item.cardTags.join(", "),
    ariaLabel: item.ariaLabel,
    eyebrow: item.eyebrow,
    title: item.title,
    person: item.person,
    route: item.route,
    avatar: item.avatar,
    avatarAlt: item.avatarAlt,
    cardQuote: item.cardQuote,
    quote: item.quote,
    tags: item.tags.join(", "),
    lead: item.lead,
    gallery: item.gallery.map((image) => `${image.src} | ${image.alt}`).join("\n"),
    steps: item.steps.join("\n"),
    reason: "",
  };
}

function validateStory(draft: StoryDraft): ValidationResult<CreateStoryRequest> {
  const required = [
    draft.ariaLabel,
    draft.eyebrow,
    draft.title,
    draft.person,
    draft.route,
    draft.avatar,
    draft.avatarAlt,
    draft.cardQuote,
    draft.quote,
    draft.lead,
    draft.reason,
  ];
  const steps = splitLines(draft.steps);
  if (required.some((value) => !value.trim()) || !steps.length) {
    return { error: "Заполните текстовые поля, причину и минимум один шаг истории." };
  }
  const galleryLines = splitLines(draft.gallery);
  const gallery = galleryLines.map((line) => {
    const separator = line.indexOf("|");
    return separator === -1
      ? null
      : { src: line.slice(0, separator).trim(), alt: line.slice(separator + 1).trim() };
  });
  if (gallery.some((image) => !image?.src || !image.alt)) {
    return { error: "Каждое изображение галереи укажите в формате: путь | alt-текст." };
  }
  return {
    body: {
      ...(draft.publicId.trim() ? { publicId: draft.publicId.trim() } : {}),
      tone: draft.tone,
      filters: splitTags(draft.filters),
      cardTags: splitTags(draft.cardTags),
      ariaLabel: draft.ariaLabel.trim(),
      eyebrow: draft.eyebrow.trim(),
      title: draft.title.trim(),
      person: draft.person.trim(),
      route: draft.route.trim(),
      avatar: draft.avatar.trim(),
      avatarAlt: draft.avatarAlt.trim(),
      cardQuote: draft.cardQuote.trim(),
      quote: draft.quote.trim(),
      tags: splitTags(draft.tags),
      lead: draft.lead.trim(),
      gallery: gallery.filter((image): image is { src: string; alt: string } => image !== null),
      steps,
      reason: draft.reason.trim(),
    },
  };
}

function StoryForm({
  draft,
  setDraft,
}: {
  draft: StoryDraft;
  setDraft: Dispatch<SetStateAction<StoryDraft>>;
}) {
  const update = <K extends keyof StoryDraft>(key: K, value: StoryDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="admin-content-form">
      <div className="admin-content-form__grid">
        <label>
          <span>Заголовок истории</span>
          <input
            value={draft.title}
            required
            onChange={(event) => update("title", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Герой истории</span>
          <input
            value={draft.person}
            required
            onChange={(event) => update("person", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Public ID (необязательно)</span>
          <input
            value={draft.publicId}
            onChange={(event) => update("publicId", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Цвет карточки</span>
          <select
            value={draft.tone}
            onChange={(event) => update("tone", event.currentTarget.value as StoryDraft["tone"])}
          >
            <option value="berry">Berry</option>
            <option value="cyan">Cyan</option>
            <option value="blue">Blue</option>
          </select>
        </label>
        <label>
          <span>Надзаголовок</span>
          <input
            value={draft.eyebrow}
            required
            onChange={(event) => update("eyebrow", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Route лендинга</span>
          <input
            value={draft.route}
            required
            onChange={(event) => update("route", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Аватар</span>
          <input
            value={draft.avatar}
            required
            onChange={(event) => update("avatar", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Alt аватара</span>
          <input
            value={draft.avatarAlt}
            required
            onChange={(event) => update("avatarAlt", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>ARIA-label карточки</span>
          <input
            value={draft.ariaLabel}
            required
            onChange={(event) => update("ariaLabel", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Фильтры (через запятую)</span>
          <input
            value={draft.filters}
            onChange={(event) => update("filters", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Теги карточки</span>
          <input
            value={draft.cardTags}
            onChange={(event) => update("cardTags", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Теги страницы</span>
          <input
            value={draft.tags}
            onChange={(event) => update("tags", event.currentTarget.value)}
          />
        </label>
      </div>
      <label>
        <span>Короткая цитата карточки</span>
        <textarea
          rows={3}
          value={draft.cardQuote}
          required
          onChange={(event) => update("cardQuote", event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Полная цитата</span>
        <textarea
          rows={4}
          value={draft.quote}
          required
          onChange={(event) => update("quote", event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Вводный текст</span>
        <textarea
          rows={4}
          value={draft.lead}
          required
          onChange={(event) => update("lead", event.currentTarget.value)}
        />
      </label>
      <div className="admin-content-form__lists">
        <label>
          <span>Шаги истории — по одному на строку</span>
          <textarea
            rows={7}
            value={draft.steps}
            required
            onChange={(event) => update("steps", event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Галерея — путь | alt-текст</span>
          <textarea
            rows={7}
            value={draft.gallery}
            onChange={(event) => update("gallery", event.currentTarget.value)}
          />
        </label>
      </div>
      <label>
        <span>Причина изменения</span>
        <textarea
          rows={3}
          value={draft.reason}
          required
          maxLength={1000}
          onChange={(event) => update("reason", event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

const VACANCY_CONFIG: ContentScreenConfig<AdminVacancy, VacancyDraft, CreateVacancyRequest> = {
  kind: "vacancy",
  title: "Вакансии лендинга",
  description:
    "Черновики, публикация и архив вакансий управляются через versioned backend registry.",
  createLabel: "Добавить вакансию",
  readPermission: "content.vacancy.read",
  managePermission: "content.vacancy.manage",
  queryKey: ["crm", "admin", "content", "vacancies"],
  operations: {
    list: "ListAdminVacancies",
    create: "CreateVacancy",
    update: "UpdateVacancy",
    publish: "PublishVacancy",
    archive: "ArchiveVacancy",
  },
  emptyDraft: emptyVacancyDraft,
  toDraft: vacancyToDraft,
  validate: validateVacancy,
  previewItems: (draft, item) => [
    { label: "Название", before: item?.title, after: draft.title || "Не указано" },
    { label: "Город", before: item?.city, after: draft.city || "Не указан" },
    { label: "Работодатель", before: item?.employer, after: draft.employer || "Не указан" },
    { label: "Статус", after: item ? stateLabel(item.state) : "Черновик" },
    { label: "Причина", after: draft.reason || "Не указана" },
  ],
  renderForm: (draft, setDraft) => <VacancyForm draft={draft} setDraft={setDraft} />,
  primaryColumns: [
    { id: "title", label: "Вакансия", render: (row) => <strong>{row.title}</strong> },
    { id: "city", label: "Город", render: (row) => row.city },
    { id: "employer", label: "Работодатель", render: (row) => row.employer },
  ],
  list: (query) => crmApi.listAdminVacancies(query),
  create: (body, key) => crmApi.createVacancy(body, key),
  update: (item, body, key) => crmApi.updateVacancy(item.id, item.version, body, key),
  publish: (item, reason, key) => crmApi.publishVacancy(item.id, item.version, reason, key),
  archive: (item, reason, key) => crmApi.archiveVacancy(item.id, item.version, reason, key),
  recordLabel: (item) => item.title,
};

const STORY_CONFIG: ContentScreenConfig<AdminStory, StoryDraft, CreateStoryRequest> = {
  kind: "story",
  title: "Истории лендинга",
  description:
    "Истории людей редактируются как типизированные записи и публикуются только после preview.",
  createLabel: "Добавить историю",
  readPermission: "content.story.read",
  managePermission: "content.story.manage",
  queryKey: ["crm", "admin", "content", "stories"],
  operations: {
    list: "ListAdminStories",
    create: "CreateStory",
    update: "UpdateStory",
    publish: "PublishStory",
    archive: "ArchiveStory",
  },
  emptyDraft: emptyStoryDraft,
  toDraft: storyToDraft,
  validate: validateStory,
  previewItems: (draft, item) => [
    { label: "История", before: item?.title, after: draft.title || "Не указана" },
    { label: "Герой", before: item?.person, after: draft.person || "Не указан" },
    { label: "Тон", before: item?.tone, after: draft.tone },
    { label: "Статус", after: item ? stateLabel(item.state) : "Черновик" },
    { label: "Причина", after: draft.reason || "Не указана" },
  ],
  renderForm: (draft, setDraft) => <StoryForm draft={draft} setDraft={setDraft} />,
  primaryColumns: [
    { id: "title", label: "История", render: (row) => <strong>{row.title}</strong> },
    { id: "person", label: "Герой", render: (row) => row.person },
    { id: "tone", label: "Тон", render: (row) => row.tone },
  ],
  list: (query) => crmApi.listAdminStories(query),
  create: (body, key) => crmApi.createStory(body, key),
  update: (item, body, key) => crmApi.updateStory(item.id, item.version, body, key),
  publish: (item, reason, key) => crmApi.publishStory(item.id, item.version, reason, key),
  archive: (item, reason, key) => crmApi.archiveStory(item.id, item.version, reason, key),
  recordLabel: (item) => item.title,
};

export function AdminVacanciesScreen() {
  return <AdminContentScreen config={VACANCY_CONFIG} />;
}

export function AdminStoriesScreen() {
  return <AdminContentScreen config={STORY_CONFIG} />;
}
