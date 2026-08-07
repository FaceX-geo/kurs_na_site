import {
  IconAlertTriangle,
  IconBell,
  IconChevronRight,
  IconLogout,
  IconMenu2,
  IconSearch,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { navigationForSession } from "@/app/navigation";
import { CRM_PATHS } from "@/app/paths";
import { AUTH_PATHS, hasBusinessRole, hasPermission, useAuth } from "@/shared/auth";
import "@/app/layout/app-shell.css";

type SearchEntry = {
  id: string;
  label: string;
  meta: string;
  to: string;
};

const NAV_GROUP_LABEL = {
  work: "Работа",
  directory: "Справочники и аналитика",
  admin: "Администрирование",
} as const;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AppShell() {
  const { authMode, enterManualAuth, session, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const searchResultsId = useId();
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);

  const currentPath = location.pathname;
  const navigation = useMemo(() => navigationForSession(session), [session]);
  const navigationGroups = useMemo(
    () =>
      (["work", "directory", "admin"] as const)
        .map((group) => ({
          group,
          items: navigation.filter((item) => item.group === group),
        }))
        .filter((entry) => entry.items.length > 0),
    [navigation],
  );
  const searchEntries = useMemo<SearchEntry[]>(
    () =>
      navigation.map((item) => ({
        id: item.id,
        label: item.label,
        meta: NAV_GROUP_LABEL[item.group],
        to: item.to,
      })),
    [navigation],
  );

  useEffect(() => {
    if (!currentPath) return;
    setMobileOpen(false);
    window.requestAnimationFrame(() => {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1");
      (heading ?? mainRef.current)?.focus({ preventScroll: true });
    });
  }, [currentPath]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const sidebar = sidebarRef.current;
    const workspace = workspaceRef.current;
    const previousOverflow = document.body.style.overflow;
    workspace?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    sidebar?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      workspace?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      mobileMenuRef.current?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);

  const results = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    if (query.length < 2) return [];
    return searchEntries.filter((entry) =>
      `${entry.label} ${entry.meta}`.toLocaleLowerCase("ru").includes(query),
    );
  }, [search, searchEntries]);

  const displayName = session?.displayName ?? "Пользователь";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  function openResult(entry: SearchEntry) {
    setSearch("");
    setSearchFocused(false);
    navigate(entry.to);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!searchFocused || results.length === 0) {
      if (event.key === "Escape") {
        setSearch("");
        setSearchFocused(false);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = results[activeSearchIndex];
      if (entry) openResult(entry);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSearchFocused(false);
    }
  }

  return (
    <div className="crm-shell">
      <a className="skip-link" href="#crm-main">
        К основному содержанию
      </a>
      <button
        ref={mobileMenuRef}
        className="crm-mobile-menu"
        type="button"
        aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((value) => !value)}
      >
        {mobileOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
      </button>

      <aside
        ref={sidebarRef}
        className={`crm-shell-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label="Основная навигация"
      >
        <div className="crm-sidebar-art" aria-hidden="true" />
        <div className="crm-sidebar-content">
          <div className="crm-brand">
            <strong>Курс на Север</strong>
            <span>CRM</span>
          </div>

          <nav className="crm-primary-nav" aria-label="Разделы CRM">
            {navigationGroups.map(({ group, items }) => (
              <div className="crm-nav-group" key={group}>
                <p>{NAV_GROUP_LABEL[group]}</p>
                {items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <NavLink
                      {...(item.end ? { end: true } : {})}
                      key={item.id}
                      to={item.to}
                      className={({ isActive }) => (isActive ? "is-active" : undefined)}
                    >
                      <ItemIcon aria-hidden="true" size={21} stroke={1.7} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="crm-sidebar-footer">
            {hasBusinessRole(session, ["SPECIALIST", "SUPER_ADMIN"]) ? (
              <button
                type="button"
                className="crm-assistant-launcher"
                onClick={() => setAssistantOpen(true)}
              >
                <span className="crm-assistant-icon">
                  <IconSparkles aria-hidden="true" size={20} />
                </span>
                <span>AI-помощник</span>
                <span className="crm-contract-dot" aria-hidden="true" />
                <span className="sr-only">Интеграция не подключена</span>
              </button>
            ) : null}
            <div className="crm-sidebar-user">
              <span className="crm-avatar">{initials}</span>
              <span>
                <strong>{displayName}</strong>
                <small>{session?.roleLabel ?? "Специалист"}</small>
              </span>
              <button type="button" aria-label="Выйти" onClick={() => void signOut()}>
                <IconLogout aria-hidden="true" size={19} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div ref={workspaceRef} className="crm-workspace">
        <header className="crm-shell-topbar">
          <div className="crm-global-search">
            <label className="sr-only" htmlFor={searchId}>
              Быстро перейти к разделу
            </label>
            <IconSearch aria-hidden="true" size={23} stroke={1.8} />
            <input
              id={searchId}
              type="search"
              value={search}
              placeholder="Быстрый переход"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchFocused && search.trim().length >= 2}
              aria-controls={searchResultsId}
              aria-activedescendant={
                searchFocused && results[activeSearchIndex]
                  ? `${searchResultsId}-${results[activeSearchIndex].id}`
                  : undefined
              }
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={handleSearchKeyDown}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setActiveSearchIndex(0);
              }}
            />
            {searchFocused && search.trim().length >= 2 ? (
              <div
                id={searchResultsId}
                className="crm-search-results"
                role="listbox"
                aria-label="Разделы CRM"
              >
                {results.length ? (
                  results.map((entry, index) => (
                    <button
                      id={`${searchResultsId}-${entry.id}`}
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeSearchIndex}
                      className={index === activeSearchIndex ? "is-active" : undefined}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openResult(entry)}
                    >
                      <span>
                        <strong>{entry.label}</strong>
                        <small>{entry.meta}</small>
                      </span>
                      <IconChevronRight aria-hidden="true" size={18} />
                    </button>
                  ))
                ) : (
                  <p>Раздел не найден. Поиск по данным появится после отдельного API-контракта.</p>
                )}
              </div>
            ) : null}
          </div>

          <div className="crm-topbar-actions">
            {authMode === "mock" ? <span className="crm-test-badge">Тестовый режим</span> : null}
            {hasPermission(session, "crm.case.list") ? (
              <NavLink to={CRM_PATHS.people} className="crm-topbar-icon" aria-label="Участники">
                <IconUsers aria-hidden="true" size={21} />
              </NavLink>
            ) : null}
            {hasPermission(session, "crm.notification.read") ? (
              <NavLink
                to={CRM_PATHS.notifications}
                className="crm-topbar-icon"
                aria-label="Уведомления"
              >
                <IconBell aria-hidden="true" size={21} />
              </NavLink>
            ) : null}
            <NavLink
              to={CRM_PATHS.settingsSecurity}
              className="crm-topbar-avatar"
              aria-label="Безопасность и сессии"
              title="Безопасность и сессии"
            >
              {initials}
            </NavLink>
          </div>
        </header>

        {session?.mutationAccess === "reauth_required" ? (
          <div className="crm-write-lock" role="status">
            <IconLogout aria-hidden size={20} />
            <span>
              <strong>Изменения временно недоступны</strong>
              CSRF-контекст этой вкладки не восстановлен. Чтение доступно, но для безопасной записи
              нужно войти заново.
            </span>
            <button
              type="button"
              onClick={() => {
                enterManualAuth();
                navigate(AUTH_PATHS.login, { replace: true });
              }}
            >
              Войти заново
            </button>
          </div>
        ) : null}

        <main id="crm-main" ref={mainRef} tabIndex={-1} className="crm-main">
          <Outlet />
        </main>
      </div>

      <AssistantPanel open={assistantOpen} onClose={closeAssistant} />
      {mobileOpen ? (
        <button
          type="button"
          className="crm-menu-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }

      const panel = panelRef.current;
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      invokerRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="crm-assistant-overlay">
      <button
        type="button"
        className="crm-assistant-backdrop"
        aria-label="Закрыть помощника"
        tabIndex={-1}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        className="crm-assistant-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        tabIndex={-1}
      >
        <header>
          <span className="crm-assistant-icon">
            <IconSparkles aria-hidden="true" size={20} />
          </span>
          <div>
            <p>Текущий scope: права активной CRM-сессии</p>
            <h2 id="assistant-title">AI-помощник</h2>
          </div>
          <button ref={closeRef} type="button" aria-label="Закрыть помощника" onClick={onClose}>
            <IconX aria-hidden="true" size={22} />
          </button>
        </header>
        <div className="crm-assistant-status" role="status">
          <IconAlertTriangle aria-hidden="true" size={20} />
          <span>
            <strong>Интеграция пока не подключена</strong>В backend OpenAPI нет AI-чата,
            инструментов и серверной квитанции. Интерфейс не имитирует готовый ответ.
          </span>
        </div>
        <p className="crm-assistant-note">
          После появления контракта помощник будет наследовать вашу роль и выполнять изменения
          только по цепочке ниже.
        </p>
        <ol className="crm-assistant-lifecycle" aria-label="Безопасный сценарий AI">
          <li>
            <span>1</span>
            <strong>Намерение и scope</strong>
            <small>Что сделать и какие записи разрешены</small>
          </li>
          <li>
            <span>2</span>
            <strong>Черновик и проверка</strong>
            <small>Источники, ограничения и конфликт версий</small>
          </li>
          <li>
            <span>3</span>
            <strong>Preview влияния</strong>
            <small>Кого и какие поля затронет действие</small>
          </li>
          <li>
            <span>4</span>
            <strong>Подтверждение и квитанция</strong>
            <small>Выполнение только сервером с audit evidence</small>
          </li>
        </ol>
        <button type="button" className="crm-primary-button" disabled>
          Ожидается backend-контракт AI
        </button>
      </section>
    </div>
  );
}
