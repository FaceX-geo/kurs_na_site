const CSRF_STORAGE_KEY = "kurs-na-sever.crm.csrf.v1";

let memoryToken: string | null = null;

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const csrfTokenStore = {
  clear(): void {
    memoryToken = null;
    getSessionStorage()?.removeItem(CSRF_STORAGE_KEY);
  },

  read(): string | null {
    return getSessionStorage()?.getItem(CSRF_STORAGE_KEY) ?? memoryToken;
  },

  write(token: string): void {
    const normalized = token.trim();
    if (!normalized) {
      this.clear();
      return;
    }

    memoryToken = normalized;
    getSessionStorage()?.setItem(CSRF_STORAGE_KEY, normalized);
  },
};

export type CsrfTokenStore = typeof csrfTokenStore;
