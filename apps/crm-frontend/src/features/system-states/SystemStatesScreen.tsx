import {
  type Icon,
  IconAlertTriangle,
  IconArchive,
  IconArrowsExchange,
  IconDatabaseOff,
  IconLoader2,
  IconLock,
} from "@tabler/icons-react";
import { type AsyncState, PageHeader, StateMessage } from "@/shared/ui";
import "./system-states.css";

type DemonstratedState = Exclude<AsyncState, "ready" | "validation" | "stale">;

interface StateDefinition {
  state: DemonstratedState;
  title: string;
  message: string;
  icon: Icon;
}

const SYSTEM_STATES = [
  {
    state: "loading",
    title: "Загружаем данные",
    message: "Структура экрана остаётся стабильной, пока сервер готовит разрешённый ответ.",
    icon: IconLoader2,
  },
  {
    state: "empty",
    title: "Записей пока нет",
    message:
      "Это корректный пустой результат, а не ошибка загрузки или скрытое ограничение доступа.",
    icon: IconDatabaseOff,
  },
  {
    state: "error",
    title: "Не удалось загрузить данные",
    message: "Повторите запрос из текущего контекста. Введённые фильтры и выбор сохраняются.",
    icon: IconAlertTriangle,
  },
  {
    state: "denied",
    title: "Недостаточно прав",
    message: "Скрытые записи, их поля и количество не показываются пользователю.",
    icon: IconLock,
  },
  {
    state: "conflict",
    title: "Версия записи изменилась",
    message:
      "Сначала загрузите актуальную версию, затем заново проверьте изменение перед подтверждением.",
    icon: IconArrowsExchange,
  },
  {
    state: "archived",
    title: "Запись находится в архиве",
    message: "Доступен только разрешённый режим чтения без неявного восстановления или изменения.",
    icon: IconArchive,
  },
] satisfies readonly StateDefinition[];

export function SystemStatesScreen() {
  return (
    <div className="system-states-screen">
      <PageHeader
        eyebrow="Системный контракт"
        title="Состояния данных"
        description="CRM различает ожидание, пустой результат, ошибку, ограничение доступа, конфликт версии и архив."
      />

      <aside className="system-states-note" aria-label="О демонстрационном экране">
        <strong>Безопасная демонстрация</strong>
        <span>На этом экране нет реальных записей, сетевых запросов и действий изменения.</span>
      </aside>

      <section className="system-states-grid" aria-label="Обязательные состояния интерфейса">
        {SYSTEM_STATES.map(({ state, title, message, icon: StateIcon }) => (
          <article className={`system-state-card system-state-card--${state}`} key={state}>
            <StateMessage
              state={state}
              title={title}
              message={message}
              icon={
                <StateIcon
                  className="system-state-card__icon"
                  aria-hidden="true"
                  size={24}
                  stroke={1.8}
                />
              }
            />
          </article>
        ))}
      </section>
    </div>
  );
}
