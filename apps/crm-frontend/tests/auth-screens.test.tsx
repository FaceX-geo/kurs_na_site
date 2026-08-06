// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_ROUTES,
  CredentialSetupPage,
  LoginPage,
  MaxChallengePage,
  MaxEnrollPage,
  MaxRecoveryPage,
} from "@/features/auth";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import { AUTH_PATHS, AuthProvider, RequireAuth } from "@/shared/auth";

function AuthTestRouter({ initialPath = AUTH_PATHS.login }: { initialPath?: string }) {
  return (
    <AuthProvider autoAuthenticate={false} mode="mock">
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path={AUTH_PATHS.login} element={<LoginPage />} />
          <Route path={AUTH_PATHS.acceptInvite} element={<CredentialSetupPage flow="invite" />} />
          <Route
            path={AUTH_PATHS.completePasswordReset}
            element={<CredentialSetupPage flow="password-reset" />}
          />
          <Route path={AUTH_PATHS.mfa} element={<MaxChallengePage />} />
          <Route path={AUTH_PATHS.recovery} element={<MaxRecoveryPage />} />
          <Route path={AUTH_PATHS.enroll} element={<MaxEnrollPage />} />
          <Route path={AUTH_PATHS.home} element={<h1>Рабочая CRM открыта</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("auth screens", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("publishes the registry auth route contract without legacy aliases", () => {
    expect(AUTH_ROUTES.map((route) => route.path)).toEqual([
      "/cabinet/login",
      "/cabinet/invite/accept",
      "/cabinet/password/reset",
      "/cabinet/mfa",
      "/cabinet/recovery",
      "/cabinet/mfa/enroll",
    ]);
  });

  it("marks the mock login unmistakably and never performs a network MAX call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AuthTestRouter />);

    expect(await screen.findByText("Вход в CRM")).not.toBeNull();
    expect(
      screen.getByText("Сначала пароль, затем второй фактор. Подключение MAX пока готовится."),
    ).not.toBeNull();
    expect(screen.queryByText("Сначала пароль, затем подтверждение в MAX.")).toBeNull();
    expect(screen.getByText("ТЕСТОВЫЙ КОНТУР · MAX НЕ ВЫЗЫВАЕТСЯ")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Войти тестово сейчас" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Войти тестово сейчас" }));
    expect(await screen.findByText("Рабочая CRM открыта")).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("supports the explicit password and manual six-digit mock sequence", async () => {
    render(<AuthTestRouter />);
    await screen.findByText("Вход в CRM");

    fireEvent.change(screen.getByLabelText("Email или логин"), {
      target: { value: "tester@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(await screen.findByText("Подтвердите вход в MAX")).not.toBeNull();
    for (let index = 1; index <= 6; index += 1) {
      fireEvent.change(screen.getByLabelText(`Цифра ${index}`), {
        target: { value: String(index) },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить 6 цифр" }));

    await waitFor(() => expect(screen.getByText("Рабочая CRM открыта")).not.toBeNull());
  });

  it("labels a TOTP challenge from the backend as TOTP, never as MAX", async () => {
    const base = createMockAuthTransport();
    const transport = {
      ...base,
      async login(input: Parameters<typeof base.login>[0]) {
        const response = await base.login(input);
        return response.status === "mfa_required"
          ? { ...response, provider: "totp" as const }
          : response;
      },
    };
    render(
      <AuthProvider autoAuthenticate={false} mode="mock" transport={transport}>
        <MemoryRouter initialEntries={[AUTH_PATHS.login]}>
          <Routes>
            <Route path={AUTH_PATHS.login} element={<LoginPage />} />
            <Route path={AUTH_PATHS.mfa} element={<MaxChallengePage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Email или логин"), {
      target: { value: "tester@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(await screen.findByRole("heading", { name: "Введите код TOTP" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /MAX/ })).toBeNull();
  });

  it("keeps recovery closed and performs the temporary TOTP enrollment flow", async () => {
    const { unmount } = render(<AuthTestRouter initialPath={AUTH_PATHS.recovery} />);
    expect(await screen.findByText("Восстановление второго фактора")).not.toBeNull();
    expect(screen.getByText("Доступ в CRM не открыт")).not.toBeNull();

    unmount();
    render(<AuthTestRouter initialPath={AUTH_PATHS.enroll} />);
    expect(await screen.findByText("Подключите второй фактор")).not.toBeNull();
    expect(screen.getByText("Тестовый TOTP-контур")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Создать ключ TOTP" }));
    expect(await screen.findByDisplayValue("mock-placeholder-not-a-real-secret")).not.toBeNull();
    for (let index = 1; index <= 6; index += 1) {
      fireEvent.change(screen.getByLabelText(`Цифра ${index}`), {
        target: { value: String(index) },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить TOTP" }));
    expect(await screen.findByText("Второй фактор подключён")).not.toBeNull();
    expect(screen.getByText("MOCK-RECOVERY-PLACEHOLDER")).not.toBeNull();
  });

  it("redirects anonymous protected routes to the public cabinet login contract", async () => {
    render(
      <AuthProvider autoAuthenticate={false} mode="mock">
        <MemoryRouter initialEntries={[AUTH_PATHS.dashboard]}>
          <Routes>
            <Route path={AUTH_PATHS.login} element={<h1>Registry login route</h1>} />
            <Route element={<RequireAuth />}>
              <Route path={AUTH_PATHS.dashboard} element={<h1>Protected dashboard</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText("Registry login route")).not.toBeNull();
    expect(screen.queryByText("Protected dashboard")).toBeNull();
  });
});
