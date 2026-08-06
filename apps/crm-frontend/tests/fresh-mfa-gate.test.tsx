// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import { AuthProvider, FreshMfaGate, useAuth } from "@/shared/auth";

function GateHarness() {
  const auth = useAuth();
  const [open, setOpen] = useState(true);
  return (
    <>
      <output aria-label="authentication-level">
        {auth.session?.authenticationLevel ?? "none"}
      </output>
      <FreshMfaGate
        open={open}
        intentLabel="Создание специалиста"
        onCancel={() => setOpen(false)}
        onVerified={() => setOpen(false)}
      />
    </>
  );
}

describe("FreshMfaGate", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("sends password and TOTP only to VerifyMfa reauth and refreshes the profile", async () => {
    const transport = createMockAuthTransport();
    const verify = vi.spyOn(transport, "verifyMfa");
    render(
      <AuthProvider mode="mock" transport={transport}>
        <GateHarness />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("authentication-level").textContent).toBe("mfa"),
    );
    fireEvent.change(screen.getByLabelText("Текущий пароль"), {
      target: { value: "not-persisted-password" },
    });
    fireEvent.change(screen.getByLabelText("Код TOTP"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить и продолжить" }));

    await waitFor(() =>
      expect(screen.getByLabelText("authentication-level").textContent).toBe("fresh_mfa"),
    );
    expect(verify).toHaveBeenCalledWith({ password: "not-persisted-password", mfaCode: "123456" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.sessionStorage.getItem("not-persisted-password")).toBeNull();
  });
});
