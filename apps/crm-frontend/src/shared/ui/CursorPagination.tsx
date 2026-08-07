export interface CursorPaginationProps {
  loadedPageCount: number;
  currentPageIndex: number;
  hasNextPage: boolean;
  onPageChange: (pageIndex: number) => void;
  onFetchNextPage: () => unknown;
  ariaLabel?: string;
  loadedItemCount?: number;
  visibleItemCount?: number;
  isFetchingNextPage?: boolean;
  repeatedCursor?: boolean;
}

export function CursorPagination({
  loadedPageCount,
  currentPageIndex,
  hasNextPage,
  onPageChange,
  onFetchNextPage,
  ariaLabel = "Пагинация списка",
  loadedItemCount,
  visibleItemCount,
  isFetchingNextPage = false,
  repeatedCursor = false,
}: CursorPaginationProps) {
  const safePageCount = Math.max(0, Math.floor(loadedPageCount));
  const safePageIndex =
    safePageCount === 0
      ? 0
      : Math.min(Math.max(0, Math.floor(currentPageIndex)), safePageCount - 1);
  const hasPreviousPage = safePageCount > 0 && safePageIndex > 0;
  const hasCachedNextPage = safePageCount > 0 && safePageIndex < safePageCount - 1;
  const canFetchNextPage = !hasCachedNextPage && hasNextPage && !repeatedCursor;
  const canMoveForward = hasCachedNextPage || canFetchNextPage;

  const nextLabel = hasCachedNextPage
    ? "Следующая"
    : isFetchingNextPage
      ? "Загружаем…"
      : repeatedCursor
        ? "Продолжение недоступно"
        : hasNextPage
          ? "Загрузить следующую"
          : "Больше страниц нет";

  const moveForward = () => {
    if (hasCachedNextPage) {
      onPageChange(safePageIndex + 1);
      return;
    }
    if (canFetchNextPage) {
      void onFetchNextPage();
    }
  };

  return (
    <nav className="crm-cursor-pagination" aria-label={ariaLabel} aria-busy={isFetchingNextPage}>
      <div className="crm-cursor-pagination__summary" aria-live="polite" aria-atomic="true">
        <strong>
          {safePageCount > 0
            ? `Текущая страница: ${safePageIndex + 1} · Загружено страниц: ${safePageCount}`
            : "Страницы ещё не загружены"}
        </strong>
        {loadedItemCount === undefined && visibleItemCount === undefined ? null : (
          <span>
            {loadedItemCount === undefined ? null : `Загружено записей: ${loadedItemCount}`}
            {loadedItemCount !== undefined && visibleItemCount !== undefined ? " · " : null}
            {visibleItemCount === undefined ? null : `На странице: ${visibleItemCount}`}
          </span>
        )}
      </div>

      <div className="crm-cursor-pagination__controls">
        <button
          type="button"
          className="crm-button crm-button--quiet"
          disabled={!hasPreviousPage}
          onClick={() => onPageChange(safePageIndex - 1)}
        >
          Предыдущая
        </button>
        <button
          type="button"
          className="crm-button crm-button--quiet"
          disabled={!canMoveForward || (isFetchingNextPage && !hasCachedNextPage)}
          onClick={moveForward}
        >
          {nextLabel}
        </button>
      </div>

      {isFetchingNextPage ? (
        <p className="crm-cursor-pagination__state" role="status">
          Загружаем следующую страницу. Уже загруженные страницы остаются доступными.
        </p>
      ) : null}
      {repeatedCursor ? (
        <p className="crm-cursor-pagination__state is-warning" role="status">
          Продолжение остановлено: сервер повторил cursor, поэтому тот же запрос не отправляется
          повторно.
        </p>
      ) : null}
    </nav>
  );
}
