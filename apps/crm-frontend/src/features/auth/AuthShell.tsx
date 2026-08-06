import { IconCompass, IconHeadset, IconShieldCheck, IconTestPipe } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { MOCK_AUTH_COPY } from "@/mocks/auth-fixtures";
import { useAuth } from "@/shared/auth";
import "@/features/auth/auth.css";

interface AuthShellProps {
  children: ReactNode;
  visualSubtitle: string;
  visualTitle?: string;
}

export function AuthShell({
  children,
  visualSubtitle,
  visualTitle = "Курс на Север",
}: AuthShellProps) {
  const { authMode } = useAuth();

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Курс на Север">
        <div className="auth-visual-copy">
          <IconCompass className="auth-compass" aria-hidden="true" stroke={1.45} />
          <h1>{visualTitle}</h1>
          <p>{visualSubtitle}</p>
        </div>
      </section>

      <section className="auth-content">
        {authMode === "mock" ? (
          <div className="auth-test-badge" role="status">
            <IconTestPipe aria-hidden="true" size={18} />
            {MOCK_AUTH_COPY.badge}
          </div>
        ) : null}

        <div className="auth-card">{children}</div>

        <footer className="auth-support">
          <IconHeadset aria-hidden="true" size={22} />
          <span>
            Нужна помощь? Обратитесь в службу поддержки.
            <small>Рабочие коды и пароли поддержка не запрашивает.</small>
          </span>
        </footer>

        <div className="auth-security-note">
          <IconShieldCheck aria-hidden="true" size={20} />
          Доступ открывается только после подтверждения второго фактора.
        </div>
      </section>
    </main>
  );
}
