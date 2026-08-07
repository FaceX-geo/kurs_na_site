import { IconArrowLeft, IconSchool, IconShieldLock } from "@tabler/icons-react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import { useAuth } from "@/shared/auth";

export function RoleHomeRedirect() {
  const { session } = useAuth();
  if (session?.businessRole === "SUPER_ADMIN" || session?.businessRole === "SPECIALIST") {
    return <Navigate replace to={CRM_PATHS.dashboard} />;
  }
  return <Navigate replace to={CRM_PATHS.denied} />;
}

export function AccessDeniedScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const from =
    typeof location.state === "object" && location.state !== null && "from" in location.state
      ? String(location.state.from)
      : null;
  return (
    <section className="route-fallback" aria-labelledby="denied-heading">
      <IconShieldLock aria-hidden="true" size={32} stroke={1.7} />
      <div>
        <p>Доступ ограничен серверной ролью</p>
        <h1 id="denied-heading">Недостаточно прав для этого раздела</h1>
        <p>
          CRM не показывает скрытые записи, их поля и количество. Обратитесь к супер-администратору,
          если рабочая роль назначена неверно.
          {from ? ` Запрошенный маршрут: ${from}.` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          navigate(
            session?.businessRole === "SUPER_ADMIN" || session?.businessRole === "SPECIALIST"
              ? CRM_PATHS.dashboard
              : CRM_PATHS.denied,
          )
        }
      >
        <IconArrowLeft aria-hidden="true" size={18} />
        Вернуться в разрешённый раздел
      </button>
    </section>
  );
}

export function StudentsBoundaryScreen() {
  const navigate = useNavigate();
  return (
    <section className="route-fallback" aria-labelledby="students-heading">
      <IconSchool aria-hidden="true" size={32} stroke={1.7} />
      <div>
        <p>Контур «Студенты»</p>
        <h1 id="students-heading">Договорный экран сохранён, API-проекция ещё не выделена</h1>
        <p>
          В backend нет отдельного student operationId. До появления versioned-контракта CRM не
          подменяет студентов общим реестром и не делает скрытую фильтрацию на клиенте.
        </p>
      </div>
      <button type="button" onClick={() => navigate(CRM_PATHS.people)}>
        Открыть все роли участников
      </button>
    </section>
  );
}

export function NotFoundScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  return (
    <section className="route-fallback" aria-labelledby="not-found-heading">
      <IconShieldLock aria-hidden="true" size={32} stroke={1.7} />
      <div>
        <p>Маршрут не зарегистрирован</p>
        <h1 id="not-found-heading">Этот экран недоступен</h1>
        <p>CRM не открывает неизвестные маршруты и не угадывает права пользователя.</p>
      </div>
      <button
        type="button"
        onClick={() =>
          navigate(
            session?.businessRole === "SUPER_ADMIN" || session?.businessRole === "SPECIALIST"
              ? CRM_PATHS.dashboard
              : CRM_PATHS.denied,
          )
        }
      >
        <IconArrowLeft aria-hidden="true" size={18} />
        Вернуться к моей работе
      </button>
    </section>
  );
}
