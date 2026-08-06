import {
  IconAlertTriangle,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconKey,
  IconShieldLock,
} from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { AuthShell } from "@/features/auth/AuthShell";
import { credentialApi } from "@/shared/api";
import { type ApiError, normalizeApiError } from "@/shared/api/errors";
import { AUTH_PATHS } from "@/shared/auth";

export type CredentialSetupFlow = "invite" | "password-reset";

const TOKEN_MIN_LENGTH = 50;
const TOKEN_MAX_LENGTH = 256;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;

export function readCredentialToken(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const token = new URLSearchParams(hash.slice(1)).get("token")?.trim() ?? "";
  return token.length >= TOKEN_MIN_LENGTH && token.length <= TOKEN_MAX_LENGTH ? token : null;
}

interface CredentialSetupPageProps {
  flow: CredentialSetupFlow;
}

export function CredentialSetupPage({ flow }: CredentialSetupPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const passwordId = useId();
  const confirmationId = useId();
  const [token, setToken] = useState<string | null>(() => readCredentialToken(location.hash));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (location.hash || location.search) {
      navigate(location.pathname, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const isInvite = flow === "invite";
  const passwordMismatch = confirmation.length > 0 && password !== confirmation;
  const passwordValid =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password === confirmation;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !passwordValid) return;

    setSubmitting(true);
    setError(null);
    try {
      if (isInvite) {
        await credentialApi.acceptInvite({ token, password });
      } else {
        await credentialApi.completePasswordReset({ token, password });
      }
      setToken(null);
      setPassword("");
      setConfirmation("");
      setCompleted(true);
    } catch (caught) {
      setError(normalizeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell visualSubtitle={isInvite ? "Активация рабочего доступа" : "Восстановление доступа"}>
      <header className="auth-heading auth-heading--left">
        <h2>{isInvite ? "Создайте пароль" : "Задайте новый пароль"}</h2>
        <p>
          {isInvite
            ? "Завершите приглашение, затем войдите и подключите обязательный второй фактор."
            : "После смены пароля войдите заново и подтвердите второй фактор."}
        </p>
      </header>

      {completed ? (
        <section className="auth-credential-result" role="status">
          <IconCheck aria-hidden size={30} />
          <div>
            <strong>{isInvite ? "Пароль создан" : "Пароль обновлён"}</strong>
            <p>
              {isInvite
                ? "Теперь войдите с новым паролем. При первом входе сервер направит вас на обязательное подключение TOTP."
                : "Старый пароль больше не действует. Продолжите через обычный защищённый вход."}
            </p>
          </div>
          <button
            className="auth-primary-button auth-full-width"
            type="button"
            onClick={() => navigate(AUTH_PATHS.login, { replace: true })}
          >
            Перейти ко входу
          </button>
        </section>
      ) : token ? (
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <div className="auth-enroll-callout">
            <IconShieldLock aria-hidden size={32} />
            <div>
              <strong>Одноразовая ссылка принята</strong>
              <p>Токен удалён из адресной строки и не сохраняется в браузере.</p>
            </div>
          </div>

          <label htmlFor={passwordId}>
            Новый пароль
            <span className="auth-password-field">
              <input
                aria-label="Новый пароль"
                id={passwordId}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
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
                {showPassword ? <IconEyeOff aria-hidden /> : <IconEye aria-hidden />}
              </button>
            </span>
            <small>Не менее 12 символов.</small>
          </label>

          <label htmlFor={confirmationId}>
            Повторите пароль
            <input
              aria-label="Повторите пароль"
              id={confirmationId}
              aria-invalid={passwordMismatch}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              type={showPassword ? "text" : "password"}
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
            {passwordMismatch ? (
              <small className="auth-field-error">Пароли не совпадают.</small>
            ) : null}
          </label>

          {error ? (
            <div className="auth-error" role="alert">
              <IconAlertTriangle aria-hidden size={20} />
              <span>
                {error.message}
                {error.requestId ? <small>Код обращения: {error.requestId}</small> : null}
              </span>
            </div>
          ) : null}

          <button
            className="auth-primary-button"
            disabled={!passwordValid || submitting}
            type="submit"
          >
            <IconKey aria-hidden size={20} />
            {submitting ? "Сохраняем…" : isInvite ? "Создать пароль" : "Сохранить новый пароль"}
          </button>
        </form>
      ) : (
        <section className="auth-warning-card" role="alert">
          <IconAlertTriangle aria-hidden size={25} />
          <span>
            <strong>Ссылка недействительна</strong>
            <small>
              Откройте полную ссылку из приглашения. Если срок истёк, запросите новую у
              супер-администратора.
            </small>
          </span>
        </section>
      )}

      {!completed ? (
        <Link className="auth-link auth-credential-back" to={AUTH_PATHS.login}>
          Вернуться ко входу
        </Link>
      ) : null}
    </AuthShell>
  );
}

export function InviteAcceptPage() {
  return <CredentialSetupPage flow="invite" />;
}

export function PasswordResetPage() {
  return <CredentialSetupPage flow="password-reset" />;
}
