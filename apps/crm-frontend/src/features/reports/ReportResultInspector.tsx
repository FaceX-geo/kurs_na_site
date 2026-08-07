import type { ReportRunResponse } from "@/shared/api";
import { StateMessage } from "@/shared/ui";

interface ResultRow {
  path: string;
  value: string;
}

const MAX_RESULT_ROWS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null) return "Нет значения";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") return value.toLocaleString("ru-RU");
  if (typeof value === "string") return value || "Пустая строка";
  return String(value);
}

function flattenResult(value: unknown, path: string, rows: ResultRow[], depth = 0): void {
  if (rows.length > MAX_RESULT_ROWS) return;

  if (depth > 8) {
    rows.push({ path, value: "Вложенность результата больше 8 уровней" });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ path, value: "Пустой массив" });
      return;
    }
    value.forEach((entry, index) => {
      flattenResult(entry, `${path}[${index}]`, rows, depth + 1);
    });
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      rows.push({ path, value: "Пустой объект" });
      return;
    }
    for (const [key, entry] of entries) {
      flattenResult(entry, path ? `${path}.${key}` : key, rows, depth + 1);
      if (rows.length >= MAX_RESULT_ROWS) break;
    }
    return;
  }

  rows.push({ path, value: formatValue(value) });
}

function inspectReportResult(result: Record<string, unknown>): {
  rows: readonly ResultRow[];
  truncated: boolean;
} {
  const rows: ResultRow[] = [];
  flattenResult(result, "", rows);
  return { rows: rows.slice(0, MAX_RESULT_ROWS), truncated: rows.length > MAX_RESULT_ROWS };
}

export function ReportResultInspector({ run }: { run: ReportRunResponse }) {
  const entries = Object.entries(run.result);
  const metrics = entries
    .filter(([, value]) => ["boolean", "number", "string"].includes(typeof value))
    .slice(0, 4);
  const { rows, truncated } = inspectReportResult(run.result);

  if (entries.length === 0) {
    return (
      <StateMessage
        state="empty"
        title="Сервер вернул пустой результат"
        message="Запуск сохранён, но объект result не содержит полей. Интерфейс не подменяет их расчётами на клиенте."
      />
    );
  }

  return (
    <section className="reports-result" aria-labelledby="reports-result-heading">
      <div className="reports-section-heading">
        <div>
          <p>Сохранённый результат API</p>
          <h3 id="reports-result-heading">Поля отчёта</h3>
        </div>
        <span>{rows.length} значений</span>
      </div>

      {metrics.length > 0 ? (
        <fieldset className="reports-metrics">
          <legend className="crm-sr-only">Верхнеуровневые значения отчёта</legend>
          {metrics.map(([key, value]) => (
            <article key={key}>
              <span>{key}</span>
              <strong>{formatValue(value)}</strong>
              <small>Название и значение получены от API</small>
            </article>
          ))}
        </fieldset>
      ) : null}

      <div className="reports-value-table">
        <table>
          <caption>Детализация объекта результата без клиентских вычислений</caption>
          <thead>
            <tr>
              <th scope="col">Путь поля API</th>
              <th scope="col">Значение</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path || "result"}>
                <th scope="row">{row.path || "result"}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <StateMessage
          compact
          state="stale"
          title="Показаны первые 200 значений"
          message="Интерфейс ограничил только визуализацию большого объекта. Сохранённый результат на сервере не изменён."
        />
      ) : null}
    </section>
  );
}
