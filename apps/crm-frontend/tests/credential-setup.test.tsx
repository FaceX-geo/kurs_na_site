// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialSetupPage } from "@/features/auth";
import { credentialApi } from "@/shared/api";
import { AUTH_PATHS, AuthProvider } from "@/shared/auth";

const TOKEN = `${"a".repeat(50)}.proof`;

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>
  );
}

function CredentialRouter({ flow, entry }: { flow: "invite" | "password-reset"; entry: string }) {
  const path = flow === "invite" ? AUTH_PATHS.acceptInvite : AUTH_PATHS.completePasswordReset;
  return (
    <AuthProvider autoAuthenticate={false} mode="mock">
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path={path} element={<CredentialSetupPage flow={flow} />} />
          <Route path={AUTH_PATHS.login} element={<h1>Защищённый вход</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("one-time credential setup", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("accepts an invitation token only from the fragment and clears it from the route", async () => {
    const accept = vi
      .spyOn(credentialApi, "acceptInvite")
      .mockResolvedValue({ status: "password_set" });
    render(
      <CredentialRouter
        flow="invite"
        entry={`${AUTH_PATHS.acceptInvite}#token=${encodeURIComponent(TOKEN)}`}
      />,
    );

    expect(await screen.findByText("Одноразовая ссылка принята")).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe(AUTH_PATHS.acceptInvite),
    );
    expect(document.body.textContent).not.toContain(TOKEN);

    fireEvent.change(screen.getByLabelText("Новый пароль"), {
      target: { value: "Correct-Horse-42" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "Correct-Horse-42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать пароль" }));

    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({ token: TOKEN, password: "Correct-Horse-42" }),
    );
    expect(await screen.findByText("Пароль создан")).not.toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("rejects query-string credentials and never calls the backend", async () => {
    const accept = vi.spyOn(credentialApi, "acceptInvite");
    render(
      <CredentialRouter
        flow="invite"
        entry={`${AUTH_PATHS.acceptInvite}?token=${encodeURIComponent(TOKEN)}`}
      />,
    );

    expect(await screen.findByText("Ссылка недействительна")).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe(AUTH_PATHS.acceptInvite),
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it("routes password reset to CompletePasswordReset and checks confirmation", async () => {
    const complete = vi
      .spyOn(credentialApi, "completePasswordReset")
      .mockResolvedValue({ status: "password_set" });
    render(
      <CredentialRouter
        flow="password-reset"
        entry={`${AUTH_PATHS.completePasswordReset}#token=${encodeURIComponent(TOKEN)}`}
      />,
    );

    fireEvent.change(await screen.findByLabelText("Новый пароль"), {
      target: { value: "Another-Horse-42" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "Another-Horse-41" },
    });
    expect(
      (screen.getByRole("button", { name: "Сохранить новый пароль" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "Another-Horse-42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить новый пароль" }));

    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith({ token: TOKEN, password: "Another-Horse-42" }),
    );
    expect(await screen.findByText("Пароль обновлён")).not.toBeNull();
  });
});
