import type { ReactNode, Ref } from "react";
import type { BreadcrumbItem } from "./types";

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: readonly BreadcrumbItem[];
  actions?: ReactNode;
  eyebrow?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}

export function PageHeader({
  title,
  description,
  breadcrumb = [],
  actions,
  eyebrow,
  headingRef,
  children,
}: PageHeaderProps) {
  return (
    <header className="crm-page-header">
      {breadcrumb.length > 0 ? (
        <nav className="crm-breadcrumb" aria-label="Путь к текущему разделу">
          <ol>
            {breadcrumb.map((item, index) => {
              const current = index === breadcrumb.length - 1;
              return (
                <li key={item.id}>
                  {item.href && !current ? (
                    <a href={item.href}>{item.label}</a>
                  ) : item.onNavigate && !current ? (
                    <button type="button" onClick={item.onNavigate}>
                      {item.label}
                    </button>
                  ) : (
                    <span aria-current={current ? "page" : undefined}>{item.label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="crm-page-header__row">
        <div className="crm-page-header__copy">
          {eyebrow ? <p className="crm-page-header__eyebrow">{eyebrow}</p> : null}
          <h1 ref={headingRef} tabIndex={-1}>
            {title}
          </h1>
          {description ? <p className="crm-page-header__description">{description}</p> : null}
        </div>
        {actions ? <div className="crm-page-header__actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
