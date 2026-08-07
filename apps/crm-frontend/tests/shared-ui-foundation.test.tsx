// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorPagination, DataTable, FilterBar, KanbanBoard, Modal } from "@/shared/ui";

afterEach(() => {
  cleanup();
});

function InlineCallbackModalHarness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть редактор
      </button>
      <Modal open={open} title="Редактор" onClose={() => setOpen(false)}>
        <label>
          Название
          <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />
        </label>
      </Modal>
    </>
  );
}

function NestedModalHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setParentOpen(true)}>
        Открыть первый уровень
      </button>
      <Modal open={parentOpen} title="Первый уровень" onClose={() => setParentOpen(false)}>
        <button type="button" onClick={() => setChildOpen(true)}>
          Открыть второй уровень
        </button>
        <Modal open={childOpen} title="Второй уровень" onClose={() => setChildOpen(false)}>
          <button type="button">Действие второго уровня</button>
        </Modal>
      </Modal>
    </>
  );
}

function BlockingNestedModalHarness() {
  const [parentOpen, setParentOpen] = useState(true);

  return (
    <Modal open={parentOpen} title="Нижний уровень" onClose={() => setParentOpen(false)}>
      <Modal open title="Блокирующий верхний уровень" dismissible={false} onClose={() => undefined}>
        <button type="button">Явное действие</button>
      </Modal>
    </Modal>
  );
}

describe("Modal focus and overlay stack", () => {
  it("does not restart the trap on inline callback or state updates and restores the invoker", () => {
    render(<InlineCallbackModalHarness />);
    const invoker = screen.getByRole("button", { name: "Открыть редактор" });

    invoker.focus();
    fireEvent.click(invoker);
    const dialog = screen.getByRole("dialog", { name: "Редактор" });
    const input = within(dialog).getByLabelText("Название");
    input.focus();
    fireEvent.change(input, { target: { value: "Новая запись" } });

    expect(document.activeElement).toBe(input);
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть окно" }));
    expect(document.activeElement).toBe(invoker);
  });

  it("lets Escape close only the top modal and restores each exact invoker", () => {
    render(<NestedModalHarness />);
    const rootInvoker = screen.getByRole("button", { name: "Открыть первый уровень" });
    rootInvoker.focus();
    fireEvent.click(rootInvoker);

    const childInvoker = screen.getByRole("button", { name: "Открыть второй уровень" });
    childInvoker.focus();
    fireEvent.click(childInvoker);
    const childDialog = screen.getByRole("dialog", { name: "Второй уровень" });
    const childAction = within(childDialog).getByRole("button", {
      name: "Действие второго уровня",
    });
    childAction.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(
      within(childDialog).getByRole("button", { name: "Закрыть окно" }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Второй уровень" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Первый уровень" })).not.toBeNull();
    expect(document.activeElement).toBe(childInvoker);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Первый уровень" })).toBeNull();
    expect(document.activeElement).toBe(rootInvoker);
  });

  it("does not let Escape fall through a non-dismissible top modal", () => {
    render(<BlockingNestedModalHarness />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Блокирующий верхний уровень" })).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Нижний уровень" })).not.toBeNull();
  });
});

describe("CursorPagination", () => {
  it("moves through cached pages before requesting the next opaque-cursor page", () => {
    const onPageChange = vi.fn();
    const onFetchNextPage = vi.fn();
    const view = render(
      <CursorPagination
        loadedPageCount={2}
        currentPageIndex={0}
        loadedItemCount={80}
        visibleItemCount={40}
        hasNextPage
        onPageChange={onPageChange}
        onFetchNextPage={onFetchNextPage}
      />,
    );

    expect(screen.getByText("Текущая страница: 1 · Загружено страниц: 2")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Следующая" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(onFetchNextPage).not.toHaveBeenCalled();

    view.rerender(
      <CursorPagination
        loadedPageCount={2}
        currentPageIndex={1}
        loadedItemCount={80}
        visibleItemCount={40}
        hasNextPage
        onPageChange={onPageChange}
        onFetchNextPage={onFetchNextPage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Предыдущая" }));
    expect(onPageChange).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Загрузить следующую" }));
    expect(onFetchNextPage).toHaveBeenCalledOnce();
  });

  it("exposes busy and repeated-cursor safe-stop states without an invented total", () => {
    const view = render(
      <CursorPagination
        loadedPageCount={3}
        currentPageIndex={2}
        hasNextPage
        isFetchingNextPage
        onPageChange={() => undefined}
        onFetchNextPage={() => undefined}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Пагинация списка" }).getAttribute("aria-busy"),
    ).toBe("true");
    expect((screen.getByRole("button", { name: "Предыдущая" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByRole("status").textContent).toContain("Загружаем следующую страницу");

    view.rerender(
      <CursorPagination
        loadedPageCount={3}
        currentPageIndex={2}
        hasNextPage
        repeatedCursor
        onPageChange={() => undefined}
        onFetchNextPage={() => undefined}
      />,
    );
    const safeStop = screen.getByRole("button", { name: "Продолжение недоступно" });
    expect((safeStop as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("сервер повторил cursor");
    expect(screen.queryByText(/из \d+ всего/)).toBeNull();
  });
});

describe("FilterBar", () => {
  it("announces active filters and exposes individual and complete reset actions", () => {
    const onRemoveFilter = vi.fn();
    const onClearAll = vi.fn();
    render(
      <FilterBar
        activeFilters={[
          { id: "city", label: "Город", valueLabel: "Мурманск" },
          { id: "state", label: "Статус", valueLabel: "В работе" },
        ]}
        resultSummary="Найдено: 28"
        onRemoveFilter={onRemoveFilter}
        onClearAll={onClearAll}
      >
        <input aria-label="Поиск" type="search" />
      </FilterBar>,
    );

    expect(screen.getByText("Активные фильтры: 2.")).not.toBeNull();
    expect(screen.getByText("Найдено: 28")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Удалить фильтр «Город: Мурманск»" }));
    expect(onRemoveFilter).toHaveBeenCalledWith("city");
    fireEvent.click(screen.getByRole("button", { name: "Сбросить все" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});

describe("DataTable responsive semantics", () => {
  it("copies every column label onto its cells for the mobile card layout", () => {
    const { container } = render(
      <DataTable
        caption="Заявки"
        columns={[
          { id: "name", label: "Участник", render: (row: { name: string }) => row.name },
          { id: "state", label: "Статус", render: () => "В работе" },
        ]}
        rows={[{ name: "Анна Соколова" }]}
        getRowId={(row) => row.name}
        state="ready"
      />,
    );

    expect(
      Array.from(container.querySelectorAll("tbody td")).map((cell) =>
        cell.getAttribute("data-label"),
      ),
    ).toEqual(["Участник", "Статус"]);
  });
});

describe("KanbanBoard move requests", () => {
  it("turns pointer drag-and-drop into a move request without mutating the card", () => {
    const onMoveRequest = vi.fn();
    const { container } = render(
      <KanbanBoard
        ariaLabel="Воронка заявок"
        columns={[
          { id: "new", title: "Новые", tone: "new" },
          { id: "review", title: "Проверка", tone: "review" },
        ]}
        cards={[{ id: "case-1", columnId: "new", title: "Заявка 1" }]}
        onMoveRequest={onMoveRequest}
      />,
    );
    const card = container.querySelector<HTMLElement>("article[draggable='true']");
    const targetColumn = screen.getByRole("region", { name: "Проверка" });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(),
    };

    expect(card).not.toBeNull();
    fireEvent.dragStart(card as HTMLElement, { dataTransfer });
    fireEvent.dragOver(targetColumn, { dataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer });

    expect(onMoveRequest).toHaveBeenCalledWith({
      card: expect.objectContaining({ id: "case-1", columnId: "new" }),
      targetColumnId: "review",
    });
    expect(
      within(screen.getByRole("region", { name: "Новые" })).getByText("Заявка 1"),
    ).not.toBeNull();
  });

  it("keeps a keyboard-operable select alternative for the same preview request", () => {
    const onMoveRequest = vi.fn();
    render(
      <KanbanBoard
        columns={[
          { id: "new", title: "Новые", tone: "new" },
          { id: "review", title: "Проверка", tone: "review" },
        ]}
        cards={[{ id: "case-1", columnId: "new", title: "Заявка 1" }]}
        onMoveRequest={onMoveRequest}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "review" } });
    expect(onMoveRequest).toHaveBeenCalledWith({
      card: expect.objectContaining({ id: "case-1" }),
      targetColumnId: "review",
    });
  });
});
