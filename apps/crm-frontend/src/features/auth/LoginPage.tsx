import { IconEye, IconEyeOff, IconLock, IconRoute } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthErrorMessage } from "@/features/auth/AuthErrorMessage";
import { AuthShell } from "@/features/auth/AuthShell";
import { MOCK_AUTH_COPY } from "@/mocks/auth-fixtures";
import { AUTH_PATHS, useAuth } from "@/shared/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { authMode, clearError, instantSignIn, signInWithPassword, status } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      const next = await signInWithPassword({ login, password });
      if (!next) {
        navigate(AUTH_PATHS.home, { replace: true });
      } else if (next.status === "mfa_enrollment_required") {
        navigate(AUTH_PATHS.enroll);
      } else {
        navigate(AUTH_PATHS.mfa);
      }
    } catch {
      // AuthProvider exposes a normalized, request-aware error for the form.
    } finally {
      setSubmitting(false);
    }
  }

  async function signInForTesting(): Promise<void> {
    clearError();
    setSubmitting(true);
    try {
      await instantSignIn();
      navigate(AUTH_PATHS.home, { replace: true });
    } catch {
      // AuthProvider owns the error state.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell visualSubtitle="Безопасная рабочая CRM">
      <header className="auth-heading">
        <h2>Вход в CRM</h2>
        <p>Сначала пароль, затем второй фактор. Подключение MAX пока готовится.</p>
      </header>

      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>
          Email или логин
          <input
            autoComplete="username"
            name="login"
            placeholder="name@example.ru"
            required
            type="text"
            value={login}
            onChange={(event) => setLogin(event.currentTarget.value)}
          />
        </label>

        <label>
          Пароль
          <span className="auth-password-field">
            <input
              autoComplete="current-password"
              name="password"
              placeholder="Введите пароль"
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <button
              type="button"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <IconEyeOff aria-hidden="true" /> : <IconEye aria-hidden="true" />}
            </button>
          </span>
        </label>

        <AuthErrorMessage />

        <button className="auth-primary-button" disabled={submitting} type="submit">
          {submitting ? "Проверяем…" : "Продолжить"}
        </button>

        <Link className="auth-link" to={AUTH_PATHS.recovery}>
          Не получается войти?
        </Link>
      </form>

      {authMode === "mock" ? (
        <section className="auth-test-panel" aria-label="Тестовый вход">
          <IconRoute aria-hidden="true" size={24} />
          <div>
            <strong>Разработка без потери времени на авторизацию</strong>
            <p>{MOCK_AUTH_COPY.disclaimer}</p>
          </div>
          <button
            className="auth-secondary-button"
            disabled={submitting || status === "loading"}
            type="button"
            onClick={() => void signInForTesting()}
          >
            Войти тестово сейчас
          </button>
        </section>
      ) : null}

      <div className="auth-trust-card">
        <IconLock aria-hidden="true" size={28} />
        <span>
          <strong>CRM не откроется до подтверждения второго фактора</strong>
          <small>Пароль сам по себе не даёт доступ к рабочим данным.</small>
        </span>
      </div>
    </AuthShell>
  );
}
