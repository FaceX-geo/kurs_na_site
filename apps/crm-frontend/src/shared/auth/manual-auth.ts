const MANUAL_AUTH_STORAGE_KEY = "kurs-na-sever.crm.manual-auth.v1";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isManualAuthRequested(): boolean {
  return storage()?.getItem(MANUAL_AUTH_STORAGE_KEY) === "1";
}

export function setManualAuthRequested(requested: boolean): void {
  if (requested) {
    storage()?.setItem(MANUAL_AUTH_STORAGE_KEY, "1");
  } else {
    storage()?.removeItem(MANUAL_AUTH_STORAGE_KEY);
  }
}
