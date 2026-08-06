import {
  IconBell,
  IconChevronRight,
  IconLogout,
  IconMenu2,
  IconSearch,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  const mainRef = useRef<HTMLElement>(null);
  const searchId = useId();
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);

  const currentPath = location.pathname;
  const navigation = useMemo(() => navigationForSession(session), [session]);
  const searchEntries = useMemo<SearchEntry[]>(
    () =>
      navigation.map((item) => ({
        id: item.id,
        label: item.label,
        meta: "Раздел CRM",
        to: item.to,
      })),
    [navigation],
  );

  useEffect(() => {
    if (!currentPath) return;
    setMobileOpen(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [currentPath]);

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

  return (
    <div className="crm-shell">
      <a className="skip-link" href="#crm-main">
        К основному содержанию
      </a>
      <button
        className="crm-mobile-menu"
        type="button"
        aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((value) => !value)}
      >
        {mobileOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
      </button>

      <aside
        className={`crm-shell-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label="Основная навигация"
      >
        <div className="crm-sidebar-art" aria-hidden="true" />
        <div className="crm-sidebar-content">
          <div className="crm-brand">
            <strong>Курс на Север</strong>
            <span>CRM</span>
          </div>

          <nav className="crm-primary-nav">
            {navigation.map((item) => {
              const ItemIcon = item.icon;
              return (
                <NavLink
                  {...(item.end ? { end: true } : {})}
                  key={item.id}
                  to={item.to}
                  className={({ isActive }) => (isActive ? "is-active" : undefined)}
                >
                  <ItemIcon aria-hidden="true" size={23} stroke={1.7} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="crm-sidebar-footer">
            {hasBusinessRole(session, ["SPECIALIST"]) ? (
              <button
                type="button"
                className="crm-assistant-launcher"
                onClick={() => setAssistantOpen(true)}
              >
                <span className="crm-assistant-icon">
                  <IconSparkles aria-hidden="true" size={20} />
                </span>
                <span>Помощник</span>
                <span className="crm-online-dot" aria-hidden="true" />
                <span className="sr-only">Доступен</span>
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

      <div className="crm-workspace">
        <header className="crm-shell-topbar">
          <div className="crm-global-search">
            <label className="sr-only" htmlFor={searchId}>
              Найти в CRM
            </label>
            <IconSearch aria-hidden="true" size={23} stroke={1.8} />
            <input
              id={searchId}
              type="search"
              value={search}
              placeholder="Найти в CRM"
              autoComplete="off"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            {searchFocused && search.trim().length >= 2 ? (
              <div className="crm-search-results" role="listbox" aria-label="Результаты поиска">
                {results.length ? (
                  results.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
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
                  <p>Совпадений нет. Измените запрос.</p>
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
                <span className="crm-notification-dot" />
              </NavLink>
            ) : null}
            <span className="crm-topbar-avatar" aria-hidden="true">
              {initials}
            </span>
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
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(false);
      return undefined;
    }

    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
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
            <p>Текущий scope: CRM · чтение</p>
            <h2 id="assistant-title">Помощник</h2>
          </div>
          <button ref={closeRef} type="button" aria-label="Закрыть помощника" onClick={onClose}>
            <IconX aria-hidden="true" size={22} />
          </button>
        </header>
        <p className="crm-assistant-note">
          Ответы используют только доступные вам данные. Любая запись начинается с черновика и
          подтверждения.
        </p>
        <label htmlFor="assistant-request">Что нужно сделать?</label>
        <textarea
          id="assistant-request"
          rows={5}
          value={request}
          placeholder="Например: подготовь задачу проверить документы Анны Смирновой"
          onChange={(event) => {
            setRequest(event.currentTarget.value);
            setDraft(false);
          }}
        />
        {draft ? (
          <div className="crm-assistant-draft" role="status">
            <strong>Черновик подготовлен</strong>
            <p>{request}</p>
            <span>Ничего не создано. Подтверждение выполняется на отдельном preview.</span>
          </div>
        ) : null}
        <button
          type="button"
          className="crm-primary-button"
          disabled={request.trim().length < 8}
          onClick={() => setDraft(true)}
        >
          Подготовить черновик
        </button>
      </section>
    </div>
  );
}
