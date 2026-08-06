import { IconAlertCircle, IconUser, IconWorld } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthErrorMessage } from "@/features/auth/AuthErrorMessage";
import { AuthShell } from "@/features/auth/AuthShell";
import { AUTH_PATHS, useAuth } from "@/shared/auth";

export function MaxRecoveryPage() {
  const navigate = useNavigate();
  const { authMode, instantSignIn, pendingAuth, recoverMax, signOut } = useAuth();
  const [recoveryCode, setRecoveryCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const challengeReady = pendingAuth?.status === "mfa_required";
  const recoveryTitle = challengeReady
    ? pendingAuth.provider === "max_otp"
      ? "MAX не подтверждён"
      : "TOTP не подтверждён"
    : "Восстановление второго фактора";

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await recoverMax(recoveryCode);
      navigate(AUTH_PATHS.home, { replace: true });
    } catch {
      // AuthProvider owns normalized errors.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell visualSubtitle="Доступ остаётся закрыт">
      <header className="auth-heading auth-heading--left">
        <h2>{recoveryTitle}</h2>
        <p>Восстановление не обходит второй фактор и фиксируется в журнале.</p>
      </header>

      <div className="auth-warning-card">
        <IconAlertCircle aria-hidden="true" size={28} />
        <span>
          <strong>Доступ в CRM не открыт</strong>
          <small>Одного пароля недостаточно. Рабочие данные остаются закрыты.</small>
        </span>
      </div>

      <dl className="auth-recovery-context">
        <div>
          <IconUser aria-hidden="true" />
          <dt>Учётная запись</dt>
          <dd>Текущий сотрудник</dd>
        </div>
        <div>
          <IconWorld aria-hidden="true" />
          <dt>Контекст</dt>
          <dd>Текущий браузер</dd>
        </div>
      </dl>

      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label>
          Код восстановления
          <input
            autoComplete="one-time-code"
            disabled={!challengeReady}
            placeholder="Введите выданный код"
            required
            type="text"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.currentTarget.value)}
          />
        </label>
        {!challengeReady ? (
          <p className="auth-form-hint">
            Сначала <Link to={AUTH_PATHS.login}>начните вход</Link>, чтобы создать запрос.
          </p>
        ) : null}
        <AuthErrorMessage />
        <button
          className="auth-secondary-button auth-full-width"
          disabled={!challengeReady || !recoveryCode.trim() || submitting}
          type="submit"
        >
          Запросить восстановление доступа
        </button>
      </form>

      {authMode === "mock" ? (
        <button
          className="auth-primary-button auth-full-width"
          type="button"
          onClick={() =>
            void instantSignIn().then(() => navigate(AUTH_PATHS.home, { replace: true }))
          }
        >
          Войти тестово без обращения в поддержку
        </button>
      ) : null}

      <button
        className="auth-link-button auth-center-link"
        type="button"
        onClick={() => void signOut().then(() => navigate(AUTH_PATHS.login, { replace: true }))}
      >
        Отменить и выйти
      </button>
    </AuthShell>
  );
}
