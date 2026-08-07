// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app/App";
import { CRM_PATHS } from "@/app/paths";

describe("CRM route contract", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", CRM_PATHS.dashboard);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("opens the registered dashboard through the visible development session", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: /Добрый день/ })).not.toBeNull();
    expect(screen.getByText("Тестовый режим")).not.toBeNull();
    expect(window.location.pathname).toBe(CRM_PATHS.dashboard);
  });

  it("keeps specialist navigation inside the registered CRM routes", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Задачи" }));

    expect(await screen.findByRole("heading", { name: "Задачи CRM" })).not.toBeNull();
    expect(window.location.pathname).toBe(CRM_PATHS.tasks);
  });

  it("offers keyboard quick navigation and a reachable security route", async () => {
    render(<App />);

    const quickNavigation = await screen.findByRole("combobox", {
      name: "Быстро перейти к разделу",
    });
    fireEvent.focus(quickNavigation);
    fireEvent.change(quickNavigation, { target: { value: "зада" } });
    expect(await screen.findByRole("option", { name: /Задачи/ })).not.toBeNull();
    fireEvent.keyDown(quickNavigation, { key: "Enter" });

    expect(await screen.findByRole("heading", { name: "Задачи CRM" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Безопасность и сессии" })).not.toBeNull();
  });

  it("traps and restores focus for the mobile navigation overlay", async () => {
    render(<App />);

    await screen.findByRole("heading", { name: /Добрый день/ });
    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);

    expect(document.querySelector(".crm-workspace")?.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".crm-workspace")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("opens a truthful AI contract gap without creating a local draft", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /AI-помощник/ }));
    const dialog = screen.getByRole("dialog", { name: "AI-помощник" });
    expect(within(dialog).getByText("Интеграция пока не подключена")).not.toBeNull();
    expect(
      (
        within(dialog).getByRole("button", {
          name: /Ожидается backend-контракт/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть помощника" }));
    expect(screen.queryByRole("dialog", { name: "AI-помощник" })).toBeNull();
  });
});
