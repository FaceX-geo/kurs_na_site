import type { ReactNode } from "react";

export interface AppShellNavigationItem {
  id: string;
  label: string;
  href: string;
  businessRoles?: readonly ("SUPER_ADMIN" | "SPECIALIST")[];
  requiredPermission?: string;
  icon?: ReactNode;
  badge?: string | number | null;
  disabled?: boolean;
}

export interface AppShellProps {
  navigation: readonly AppShellNavigationItem[];
  activeRoute: string;
  children: ReactNode;
  onNavigate?: (item: AppShellNavigationItem) => void;
  search?: ReactNode;
  notifications?: ReactNode;
  user?: ReactNode;
  assistantAction?: ReactNode;
  brand?: ReactNode;
  mobileNavigationLabel?: string;
}

export function SidebarNav({
  navigation,
  activeRoute,
  onNavigate,
}: Pick<AppShellProps, "navigation" | "activeRoute" | "onNavigate">) {
  return (
    <nav className="crm-sidebar-nav" aria-label="Основная навигация">
      <ul>
        {navigation.map((item) => {
          const active = item.href === activeRoute || activeRoute.startsWith(`${item.href}/`);
          return (
            <li key={item.id}>
              <a
                className={active ? "is-active" : undefined}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-disabled={item.disabled}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  if (onNavigate) {
                    event.preventDefault();
                    onNavigate(item);
                  }
                }}
              >
                {item.icon ? <span className="crm-sidebar-nav__icon">{item.icon}</span> : null}
                <span>{item.label}</span>
                {item.badge === null || item.badge === undefined ? null : (
                  <span className="crm-sidebar-nav__badge">{item.badge}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({
  navigation,
  activeRoute,
  children,
  onNavigate,
  search,
  notifications,
  user,
  assistantAction,
  brand,
  mobileNavigationLabel = "Разделы CRM",
}: AppShellProps) {
  return (
    <div className="crm-app-shell">
      <aside className="crm-sidebar">
        <div className="crm-sidebar__brand">{brand ?? <strong>Курс на Север</strong>}</div>
        <SidebarNav
          navigation={navigation}
          activeRoute={activeRoute}
          {...(onNavigate ? { onNavigate } : {})}
        />
        {assistantAction ? <div className="crm-sidebar__assistant">{assistantAction}</div> : null}
      </aside>
      <header className="crm-topbar">
        <span className="crm-sr-only">{mobileNavigationLabel}</span>
        <div className="crm-topbar__search">{search}</div>
        <div className="crm-topbar__actions">
          {notifications}
          {user}
        </div>
      </header>
      <main className="crm-app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
