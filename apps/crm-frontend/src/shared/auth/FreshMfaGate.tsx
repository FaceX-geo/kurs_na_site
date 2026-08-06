import { IconEye, IconEyeOff, IconShieldLock } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type ApiError, normalizeApiError } from "@/shared/api/errors";
import { useAuth } from "@/shared/auth/AuthProvider";
import { Modal, StateMessage } from "@/shared/ui";

interface FreshMfaGateProps {
  open: boolean;
  onCancel(): void;
  onVerified(): void;
  intentLabel: string;
}

export function FreshMfaGate({ open, onCancel, onVerified, intentLabel }: FreshMfaGateProps) {
  const { clearError, reauthenticate } = useAuth();
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setMfaCode("");
      setShowPassword(false);
      setError(null);
    }
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!password || !/^\d{6}$/.test(mfaCode)) return;
    clearError();
    setError(null);
    setSubmitting(true);
    try {
      await reauthenticate(password, mfaCode);
      setPassword("");
      setMfaCode("");
      onVerified();
    } catch (caught) {
      setError(normalizeApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Подтвердите критическое действие"
      description={`${intentLabel}. Подтверждение выдаёт только короткий fresh-MFA контекст.`}
      dismissible={!submitting}
      onClose={onCancel}
      size="narrow"
    >
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <div className="auth-enroll-callout">
          <IconShieldLock aria-hidden size={30} />
          <div>
            <strong>Повторная проверка личности</strong>
            <p>Пароль и код не сохраняются и не попадут в квитанцию операции.</p>
          </div>
        </div>

        <label>
          Текущий пароль
          <span className="auth-password-field">
            <input
              autoComplete="current-password"
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
        </label>

        <label>
          Код TOTP
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            required
            value={mfaCode}
            onChange={(event) =>
              setMfaCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        </label>

        {error ? (
          <StateMessage
            state={error.status === 429 ? "stale" : "error"}
            title="Подтверждение не выполнено"
            message={error.message}
          />
        ) : null}

        <div className="auth-actions-row">
          <button
            className="auth-link-button"
            disabled={submitting}
            type="button"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="auth-primary-button"
            disabled={!password || mfaCode.length !== 6 || submitting}
            type="submit"
          >
            {submitting ? "Подтверждаем…" : "Подтвердить и продолжить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
