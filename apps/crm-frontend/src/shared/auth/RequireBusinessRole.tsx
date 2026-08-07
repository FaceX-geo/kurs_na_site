import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import { useAuth } from "@/shared/auth/AuthProvider";
import { hasBusinessRole } from "@/shared/auth/policy";
import type { BusinessRole } from "@/shared/auth/types";

export interface RequireBusinessRoleProps {
  allowed: readonly BusinessRole[];
  children?: ReactNode;
}

export function RequireBusinessRole({ allowed, children }: RequireBusinessRoleProps) {
  const { session } = useAuth();
  const location = useLocation();
  if (!hasBusinessRole(session, allowed)) {
    return (
      <Navigate
        replace
        to={CRM_PATHS.denied}
        state={{ from: location.pathname, requiredBusinessRoles: allowed }}
      />
    );
  }
  return children ?? <Outlet />;
}
