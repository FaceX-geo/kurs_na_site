import { IconAlertCircle } from "@tabler/icons-react";
import { useAuth } from "@/shared/auth";

export function AuthErrorMessage() {
  const { error } = useAuth();
  if (!error) return null;

  return (
    <div className="auth-error" role="alert">
      <IconAlertCircle aria-hidden="true" size={20} />
      <span>
        {error.message}
        {error.requestId ? <small>Код для поддержки: {error.requestId}</small> : null}
      </span>
    </div>
  );
}
