interface CursorPage {
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export function nextCursorForPage(page: CursorPage): string | undefined {
  return page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined;
}

export function hasRepeatedNextCursor(pages: readonly CursorPage[]): boolean {
  const last = pages.at(-1);
  const nextCursor = last ? nextCursorForPage(last) : undefined;
  if (!nextCursor) return false;
  return pages.slice(0, -1).some((page) => page.page.nextCursor === nextCursor);
}
