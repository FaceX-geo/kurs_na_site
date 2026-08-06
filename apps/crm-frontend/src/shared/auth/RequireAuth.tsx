import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "@/shared/auth/AuthProvider";
import { AUTH_PATHS } from "@/shared/auth/paths";

interface RequireAuthProps {
  children?: ReactNode;
  loadingFallback?: ReactNode;
}

export function RequireAuth({ children, loadingFallback }: RequireAuthProps) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return loadingFallback ?? <div role="status">Проверяем рабочий сеанс…</div>;
  }

  if (status === "anonymous") {
    return <Navigate to={AUTH_PATHS.login} replace state={{ from: location.pathname }} />;
  }

  return children ?? <Outlet />;
}
