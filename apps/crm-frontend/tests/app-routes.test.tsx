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

    expect(await screen.findByRole("heading", { name: "Мои задачи" })).not.toBeNull();
    expect(window.location.pathname).toBe(CRM_PATHS.tasks);
  });

  it("opens and closes the assistant without creating a write", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Помощник/ }));
    const dialog = screen.getByRole("dialog", { name: "Помощник" });
    fireEvent.change(within(dialog).getByLabelText("Что нужно сделать?"), {
      target: { value: "Подготовить задачу проверить документы" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Подготовить черновик" }));
    expect(screen.getByText(/Ничего не создано/)).not.toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть помощника" }));
    expect(screen.queryByRole("dialog", { name: "Помощник" })).toBeNull();
  });
});
