// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatesScreen } from "@/features/system-states";

describe("SystemStatesScreen", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders six distinct safe states without reading CRM data", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<SystemStatesScreen />);

    expect(screen.getByRole("heading", { level: 1, name: "Состояния данных" })).not.toBeNull();
    for (const title of [
      "Загружаем данные",
      "Записей пока нет",
      "Не удалось загрузить данные",
      "Недостаточно прав",
      "Версия записи изменилась",
      "Запись находится в архиве",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).not.toBeNull();
    }

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(4);
    expect(screen.getByText(/Скрытые записи, их поля и количество не показываются/)).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
