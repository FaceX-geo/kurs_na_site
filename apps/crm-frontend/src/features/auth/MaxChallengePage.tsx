import {
  IconClock,
  IconDeviceDesktop,
  IconHourglass,
  IconLock,
  IconMapPin,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthErrorMessage } from "@/features/auth/AuthErrorMessage";
import { AuthShell } from "@/features/auth/AuthShell";
import { OtpInput } from "@/features/auth/OtpInput";
import { MOCK_AUTH_COPY } from "@/mocks/auth-fixtures";
import { AUTH_PATHS, useAuth } from "@/shared/auth";

export function MaxChallengePage() {
  const navigate = useNavigate();
  const { authMode, instantSignIn, pendingAuth, signOut, verifyMax } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const challengeReady = pendingAuth?.status === "mfa_required";
  const provider = challengeReady ? pendingAuth.provider : null;
  const isTotp = provider === "totp";

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await verifyMax(code);
      navigate(AUTH_PATHS.home, { replace: true });
    } catch {
      // AuthProvider owns normalized errors.
    } finally {
      setSubmitting(false);
    }
  }

  async function exit(): Promise<void> {
    await signOut();
    navigate(AUTH_PATHS.login, { replace: true });
  }

  return (
    <AuthShell visualSubtitle="Второй фактор обязателен">
      <header className="auth-heading">
        <h2>{isTotp ? "Введите код TOTP" : "Подтвердите вход в MAX"}</h2>
        <p>
          {isTotp
            ? "Введите короткоживущий код из приложения-аутентификатора."
            : "Введите короткоживущий код из привязанного рабочего чата."}
        </p>
      </header>

      {authMode === "mock" ? (
        <div className="auth-inline-status auth-inline-status--test">
          <IconHourglass aria-hidden="true" size={20} />
          <span>{MOCK_AUTH_COPY.challengeHint}</span>
        </div>
      ) : (
        <div className="auth-inline-status">
          <IconHourglass aria-hidden="true" size={20} />
          <span>
            {isTotp
              ? "Код создаётся локально в вашем приложении-аутентификаторе"
              : "Ожидаем код · доставка не подтверждена"}
          </span>
        </div>
      )}

      <dl className="auth-context-list">
        <div>
          <IconDeviceDesktop aria-hidden="true" size={21} />
          <dt>Устройство</dt>
          <dd>Текущий браузер</dd>
        </div>
        <div>
          <IconMapPin aria-hidden="true" size={21} />
          <dt>Контекст</dt>
          <dd>Рабочий вход в CRM</dd>
        </div>
        <div>
          <IconClock aria-hidden="true" size={21} />
          <dt>Срок</dt>
          <dd>Код действует 5 минут</dd>
        </div>
      </dl>

      {!challengeReady ? (
        <div className="auth-error" role="alert">
          <IconLock aria-hidden="true" size={20} />
          <span>
            Активного запроса нет. <Link to={AUTH_PATHS.login}>Начните вход заново.</Link>
          </span>
        </div>
      ) : null}

      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <OtpInput disabled={!challengeReady || submitting} value={code} onChange={setCode} />
        <AuthErrorMessage />
        <button
          className="auth-primary-button"
          disabled={!challengeReady || code.length !== 6 || submitting}
          type="submit"
        >
          {submitting ? "Подтверждаем…" : "Подтвердить 6 цифр"}
        </button>
      </form>

      {authMode === "mock" ? (
        <button
          className="auth-secondary-button auth-full-width"
          disabled={submitting}
          type="button"
          onClick={() =>
            void instantSignIn().then(() => navigate(AUTH_PATHS.home, { replace: true }))
          }
        >
          Пропустить код и войти тестово
        </button>
      ) : null}

      <div className="auth-actions-row">
        <Link className="auth-link" to={AUTH_PATHS.recovery}>
          Использовать восстановление
        </Link>
        <button className="auth-link-button" type="button" onClick={() => void exit()}>
          Это не я — выйти
        </button>
      </div>

      <div className="auth-factor-strip">
        <span>
          <IconShieldCheck aria-hidden="true" />
          Пароль подтверждён
        </span>
        <span>
          <IconLock aria-hidden="true" />
          {isTotp ? "TOTP — второй фактор" : "MAX — второй фактор"}
        </span>
        <span>
          <IconShieldCheck aria-hidden="true" />
          Код одноразовый
        </span>
      </div>
    </AuthShell>
  );
}
