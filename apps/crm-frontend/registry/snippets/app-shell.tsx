// component-id: ui.app-shell
import { AppShell } from "@/app/layout/AppShell";

export function AppShellSnippet() {
  // Runtime ownership is deliberate: AuthProvider and React Router supply the
  // session, effective permissions, current route and nested Outlet.
  return <AppShell />;
}
