// component-id: ui.cursor-pagination
import { useState } from "react";
import { CursorPagination } from "@/shared/ui";

export function CursorPaginationSnippet() {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(2);
  const [fetching, setFetching] = useState(false);

  const fetchNextPage = async () => {
    setFetching(true);
    await Promise.resolve();
    setPageCount((count) => count + 1);
    setPageIndex(pageCount);
    setFetching(false);
  };

  return (
    <CursorPagination
      loadedPageCount={pageCount}
      currentPageIndex={pageIndex}
      loadedItemCount={pageCount * 50}
      visibleItemCount={50}
      hasNextPage={pageCount < 3}
      isFetchingNextPage={fetching}
      onPageChange={setPageIndex}
      onFetchNextPage={fetchNextPage}
    />
  );
}
