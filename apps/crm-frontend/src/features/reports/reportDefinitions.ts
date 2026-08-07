import type { BuildReportRequest, ReportCode } from "@/shared/api";

export interface ReportFilterField {
  key:
    | "dataQualityState"
    | "dueBefore"
    | "entryPointCode"
    | "funnelCode"
    | "municipality"
    | "profileState"
    | "resultCode"
    | "sourceCode"
    | "stageCode"
    | "state"
    | "status";
  label: string;
  placeholder: string;
  type?: "datetime-local" | "text";
}

export interface ReportDefinition {
  code: ReportCode;
  title: string;
  description: string;
  subject: string;
  filters: readonly ReportFilterField[];
}

export type ReportFilterValues = Record<string, string>;

export const REPORT_CODE_FILTER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

export function isCodeFilter(field: ReportFilterField): boolean {
  return field.key !== "dueBefore" && field.key !== "municipality";
}

export function reportFilterMaxLength(field: ReportFilterField): number | undefined {
  if (field.key === "municipality") return 500;
  return isCodeFilter(field) ? 96 : undefined;
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    code: "pipeline.summary",
    title: "Воронка заявок",
    description: "Сводка по этапам и статусам в доступной сервером области.",
    subject: "заявки и этапы",
    filters: [
      { key: "funnelCode", label: "Код воронки", placeholder: "Например, relocation" },
      { key: "status", label: "Статус заявки", placeholder: "Например, open" },
    ],
  },
  {
    code: "workload.summary",
    title: "Нагрузка специалистов",
    description: "Состояния и сроки CRM-задач без раскрытия чужой области доступа.",
    subject: "задачи и сроки",
    filters: [
      { key: "state", label: "Состояние задачи", placeholder: "Например, open" },
      {
        key: "dueBefore",
        label: "Срок до",
        placeholder: "Дата и время",
        type: "datetime-local",
      },
    ],
  },
  {
    code: "referrals.outcomes",
    title: "Результаты направлений",
    description: "Подтверждённые исходы направлений с фильтром по этапу.",
    subject: "направления и исходы",
    filters: [{ key: "stageCode", label: "Код этапа", placeholder: "Например, accepted" }],
  },
  {
    code: "applications.sources",
    title: "Источники заявок",
    description: "Распределение источников и точек входа, сохранённых в CRM.",
    subject: "источники и точки входа",
    filters: [
      { key: "sourceCode", label: "Код источника", placeholder: "Например, landing" },
      { key: "entryPointCode", label: "Точка входа", placeholder: "Например, vacancy" },
    ],
  },
  {
    code: "employers.activity",
    title: "Активность работодателей",
    description: "Активность работодателей в границах выданных пользователю прав.",
    subject: "работодатели",
    filters: [{ key: "status", label: "Статус работодателя", placeholder: "Например, active" }],
  },
  {
    code: "relocation.results",
    title: "Результаты переезда",
    description: "Исходы переезда по муниципалитетам из сохранённых данных CRM.",
    subject: "переезды и муниципалитеты",
    filters: [
      { key: "resultCode", label: "Код результата", placeholder: "Например, relocated" },
      { key: "municipality", label: "Муниципалитет", placeholder: "Например, Мурманск" },
    ],
  },
  {
    code: "data_quality.summary",
    title: "Качество данных",
    description: "Пробелы профилей и состояния качества без догадок на стороне интерфейса.",
    subject: "профили и качество данных",
    filters: [
      { key: "profileState", label: "Состояние профиля", placeholder: "Например, active" },
      {
        key: "dataQualityState",
        label: "Состояние качества",
        placeholder: "Например, incomplete",
      },
    ],
  },
] as const;

export const REPORT_DEFINITION_BY_CODE = new Map(
  REPORT_DEFINITIONS.map((definition) => [definition.code, definition]),
);

export function getReportDefinition(reportCode: ReportCode): ReportDefinition {
  const definition = REPORT_DEFINITION_BY_CODE.get(reportCode);
  if (!definition) throw new Error(`Unknown report code: ${reportCode}`);
  return definition;
}

function optionalFilter(values: ReportFilterValues, key: string): string | undefined {
  const value = values[key]?.trim();
  return value ? value : undefined;
}

function compactFilters(filters: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function buildReportRequest(
  reportCode: ReportCode,
  values: ReportFilterValues,
  timezone: string,
  reason: string,
): BuildReportRequest {
  const common = { timezone, reason };

  switch (reportCode) {
    case "pipeline.summary":
      return {
        reportCode,
        ...common,
        filters: compactFilters({
          funnelCode: optionalFilter(values, "funnelCode"),
          status: optionalFilter(values, "status"),
        }),
      };
    case "workload.summary": {
      const dueBefore = optionalFilter(values, "dueBefore");
      return {
        reportCode,
        ...common,
        filters: compactFilters({
          state: optionalFilter(values, "state"),
          dueBefore: dueBefore ? new Date(dueBefore).toISOString() : undefined,
        }),
      };
    }
    case "referrals.outcomes":
      return {
        reportCode,
        ...common,
        filters: compactFilters({ stageCode: optionalFilter(values, "stageCode") }),
      };
    case "applications.sources":
      return {
        reportCode,
        ...common,
        filters: compactFilters({
          sourceCode: optionalFilter(values, "sourceCode"),
          entryPointCode: optionalFilter(values, "entryPointCode"),
        }),
      };
    case "employers.activity":
      return {
        reportCode,
        ...common,
        filters: compactFilters({ status: optionalFilter(values, "status") }),
      };
    case "relocation.results":
      return {
        reportCode,
        ...common,
        filters: compactFilters({
          resultCode: optionalFilter(values, "resultCode"),
          municipality: optionalFilter(values, "municipality"),
        }),
      };
    case "data_quality.summary":
      return {
        reportCode,
        ...common,
        filters: compactFilters({
          profileState: optionalFilter(values, "profileState"),
          dataQualityState: optionalFilter(values, "dataQualityState"),
        }),
      };
  }
}
