import { IconCheck, IconCopy, IconInfoCircle, IconKey, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { AuthErrorMessage } from "@/features/auth/AuthErrorMessage";
import { AuthShell } from "@/features/auth/AuthShell";
import { OtpInput } from "@/features/auth/OtpInput";
import type { EnrollMfaStartedResponse } from "@/shared/api";
import { AUTH_PATHS, useAuth } from "@/shared/auth";

export function MaxEnrollPage() {
  const navigate = useNavigate();
  const { authMode, confirmMfaEnrollment, signOut, startMfaEnrollment } = useAuth();
  const [setup, setSetup] = useState<EnrollMfaStartedResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function start(): Promise<void> {
    setSubmitting(true);
    try {
      setSetup(await startMfaEnrollment());
    } catch {
      // AuthProvider exposes the normalized server error.
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      setRecoveryCodes(await confirmMfaEnrollment(code));
    } catch {
      // AuthProvider exposes the normalized server error.
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(value: string): Promise<void> {
    await navigator.clipboard?.writeText(value);
  }

  return (
    <AuthShell visualSubtitle="Подключение обязательной защиты">
      <header className="auth-heading auth-heading--left">
        <h2>Подключите второй фактор</h2>
        <p>Временный TOTP-контур работает до production-интеграции MAX.</p>
      </header>

      <ol className="auth-steps" aria-label="Этапы привязки">
        <li className={!setup ? "is-active" : undefined}>
          <span>1</span>Получить ключ
        </li>
        <li className={setup && !recoveryCodes ? "is-active" : undefined}>
          <span>2</span>Добавить TOTP
        </li>
        <li className={recoveryCodes ? "is-active" : undefined}>
          <span>3</span>Сохранить recovery
        </li>
      </ol>

      <section className="auth-enroll-callout">
        <IconShieldCheck aria-hidden size={38} />
        <div>
          <strong>
            {authMode === "mock" ? "Тестовый TOTP-контур" : "Временный TOTP-контур до MAX"}
          </strong>
          <p>
            Production не bypass-ит MFA: сервер создаёт одноразовый secret, проверяет реальный код
            приложения-аутентификатора и только затем открывает CRM.
          </p>
        </div>
      </section>

      {!setup ? (
        <button
          className="auth-primary-button auth-full-width"
          disabled={submitting}
          type="button"
          onClick={() => void start()}
        >
          <IconKey aria-hidden size={20} />
          {submitting ? "Создаём ключ…" : "Создать ключ TOTP"}
        </button>
      ) : null}

      {setup && !recoveryCodes ? (
        <>
          <section className="auth-test-panel" aria-label="Данные привязки TOTP">
            <IconKey aria-hidden size={24} />
            <div>
              <strong>Добавьте ключ в приложение-аутентификатор</strong>
              <p>Ключ действует до {new Date(setup.expiresAt).toLocaleString("ru-RU")}.</p>
              <label>
                Secret
                <input
                  readOnly
                  value={setup.secret}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button
                type="button"
                className="auth-link-button"
                onClick={() => void copy(setup.secret)}
              >
                <IconCopy aria-hidden size={17} /> Копировать secret
              </button>
              <label>
                otpauth URI
                <textarea
                  readOnly
                  rows={3}
                  value={setup.uri}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <button
                type="button"
                className="auth-link-button"
                onClick={() => void copy(setup.uri)}
              >
                <IconCopy aria-hidden size={17} /> Копировать URI
              </button>
            </div>
          </section>

          <form className="auth-form" onSubmit={(event) => void confirm(event)}>
            <OtpInput disabled={submitting} value={code} onChange={setCode} />
            <AuthErrorMessage />
            <button
              className="auth-primary-button"
              disabled={code.length !== 6 || submitting}
              type="submit"
            >
              <IconCheck aria-hidden size={20} />
              {submitting ? "Проверяем код…" : "Подтвердить TOTP"}
            </button>
          </form>
        </>
      ) : null}

      {recoveryCodes ? (
        <section className="auth-test-panel" aria-label="Коды восстановления" role="status">
          <IconShieldCheck aria-hidden size={24} />
          <div>
            <strong>Второй фактор подключён</strong>
            <p>Сохраните коды восстановления сейчас. После ухода с экрана CRM их не хранит.</p>
            <ul>
              {recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>
                  <code>{recoveryCode}</code>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="auth-link-button"
              onClick={() => void copy(recoveryCodes.join("\n"))}
            >
              <IconCopy aria-hidden size={17} /> Копировать коды
            </button>
          </div>
          <button
            className="auth-primary-button"
            type="button"
            onClick={() => navigate(AUTH_PATHS.home, { replace: true })}
          >
            Перейти в CRM
          </button>
        </section>
      ) : null}

      <AuthErrorMessage />
      <p className="auth-form-hint auth-info-line">
        <IconInfoCircle aria-hidden size={19} />
        MAX пока остаётся маркированной UI-заглушкой. Secret и recovery codes не логируются и не
        сохраняются в браузере.
      </p>

      {!recoveryCodes ? (
        <button
          className="auth-link-button auth-center-link"
          type="button"
          onClick={() => void signOut().then(() => navigate(AUTH_PATHS.login, { replace: true }))}
        >
          Отменить и выйти
        </button>
      ) : null}
    </AuthShell>
  );
}
