// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAuthTransport } from "@/mocks/mock-auth-transport";
import { csrfTokenStore } from "@/shared/api";
import { AuthProvider, useAuth } from "@/shared/auth";

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <output aria-label="status">{auth.status}</output>
      <output aria-label="mode">{auth.authMode}</output>
      <output aria-label="email">{auth.session?.user.email ?? "none"}</output>
      <output aria-label="challenge">{auth.pendingAuth?.status ?? "none"}</output>
      <output aria-label="auth-level">{auth.session?.authenticationLevel ?? "none"}</output>
      <output aria-label="mutation-access">{auth.session?.mutationAccess ?? "none"}</output>
      <button type="button" onClick={auth.enterManualAuth}>
        manual
      </button>
      <button
        type="button"
        onClick={() => void auth.signInWithPassword({ login: "tester", password: "test" })}
      >
        first-factor
      </button>
      <button type="button" onClick={() => void auth.verifyMax("123456")}>
        verify
      </button>
      <button type="button" onClick={() => void auth.reauthenticate("test-password", "123456")}>
        reauthenticate
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.sessionStorage.clear();
    csrfTokenStore.clear();
  });

  it("automatically opens a safe development session and can return to manual auth", async () => {
    render(
      <AuthProvider mode="mock">
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("status").textContent).toBe("authenticated"));
    expect(screen.getByLabelText("mode").textContent).toBe("mock");
    expect(screen.getByLabelText("email").textContent).toContain("example.test");

    fireEvent.click(screen.getByRole("button", { name: "manual" }));
    expect(screen.getByLabelText("status").textContent).toBe("anonymous");
  });

  it("keeps password and MAX challenge as explicit manual steps", async () => {
    const transport = createMockAuthTransport();
    const profileSpy = vi.spyOn(transport, "getOwnProfile");
    render(
      <AuthProvider autoAuthenticate={false} mode="mock" transport={transport}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("status").textContent).toBe("anonymous"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "first-factor" }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText("challenge").textContent).toBe("mfa_required"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "verify" }));
    });
    await waitFor(() => expect(screen.getByLabelText("status").textContent).toBe("authenticated"));
    expect(profileSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes the session and profile through the fresh-MFA reauth branch", async () => {
    const transport = createMockAuthTransport();
    render(
      <AuthProvider mode="mock" transport={transport}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("auth-level").textContent).toBe("mfa"));
    fireEvent.click(screen.getByRole("button", { name: "reauthenticate" }));
    await waitFor(() => expect(screen.getByLabelText("auth-level").textContent).toBe("fresh_mfa"));
  });

  it("restores a tab-local CSRF token for an existing cookie session", async () => {
    const transport = createMockAuthTransport({ initiallyAuthenticated: true });
    const refresh = vi.spyOn(transport, "refreshCsrfToken");
    render(
      <AuthProvider autoAuthenticate={false} mode="mock" transport={transport}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("status").textContent).toBe("authenticated"));
    expect(screen.getByLabelText("mutation-access").textContent).toBe("ready");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a valid profile read-only when CSRF refresh fails", async () => {
    const base = createMockAuthTransport({ initiallyAuthenticated: true });
    const transport = {
      ...base,
      async refreshCsrfToken(): ReturnType<typeof base.refreshCsrfToken> {
        throw new Error("refresh unavailable");
      },
    };
    render(
      <AuthProvider autoAuthenticate={false} mode="mock" transport={transport}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("status").textContent).toBe("authenticated"));
    expect(screen.getByLabelText("mutation-access").textContent).toBe("reauth_required");
  });
});
