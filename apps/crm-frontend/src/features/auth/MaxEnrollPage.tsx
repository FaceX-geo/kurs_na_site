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
    <AuthShell visualSubtitle="Настройка защиты доступа">
      <header className="auth-heading auth-heading--left">
        <h2>Подключите второй фактор</h2>
        <p>Для этого пользователя требуется временная TOTP-защита до отдельной интеграции MAX.</p>
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
            {authMode === "mock" ? "Тестовый TOTP-контур" : "Приложение-аутентификатор"}
          </strong>
          <p>
            Откройте приложение-аутентификатор, добавьте ключ и подтвердите первый код. CRM не
            сохраняет ключ и коды восстановления в браузере.
          </p>
        </div>
      </section>

      <AuthErrorMessage />

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
          <section className="auth-enrollment-data" aria-label="Данные привязки TOTP">
            <IconKey aria-hidden size={24} />
            <div>
              <strong>Добавьте ключ</strong>
              <p>
                Ключ действует до{" "}
                <time dateTime={setup.expiresAt}>
                  {new Date(setup.expiresAt).toLocaleString("ru-RU")}
                </time>
                .
              </p>
              <code className="auth-secret-value">{setup.secret}</code>
              <button
                type="button"
                className="auth-copy-button"
                onClick={() => void copy(setup.secret)}
              >
                <IconCopy aria-hidden size={17} /> Скопировать ключ
              </button>
              <details className="auth-enrollment-uri">
                <summary>Нужен URI для ручного добавления</summary>
                <code>{setup.uri}</code>
                <button
                  type="button"
                  className="auth-link-button"
                  onClick={() => void copy(setup.uri)}
                >
                  <IconCopy aria-hidden size={17} /> Скопировать URI
                </button>
              </details>
            </div>
          </section>

          <form className="auth-form" onSubmit={(event) => void confirm(event)}>
            <OtpInput disabled={submitting} value={code} onChange={setCode} />
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

      <p className="auth-form-hint auth-info-line">
        <IconInfoCircle aria-hidden size={19} />
        MAX пока не участвует в этом сценарии. Secret и recovery codes не логируются и не
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
