import type { ReactNode } from "react";

export interface Entity360Fact {
  label: string;
  value: ReactNode;
  sensitive?: boolean;
}

export interface Entity360Section {
  id: string;
  title: string;
  facts: readonly Entity360Fact[];
}

export interface Entity360TimelineItem {
  id: string;
  title: string;
  timestamp: string;
  body?: string;
  sourceLabel: string;
}

export interface Entity360Props {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  sections: readonly Entity360Section[];
  timeline?: readonly Entity360TimelineItem[];
  provenance?: readonly { label: string; value: ReactNode }[];
  actions?: ReactNode;
}

export function Entity360({
  title,
  subtitle,
  status,
  sections,
  timeline = [],
  provenance = [],
  actions,
}: Entity360Props) {
  return (
    <article className="crm-entity-360" aria-labelledby="crm-entity-360-title">
      <header className="crm-entity-360__header">
        <div>
          <h1 id="crm-entity-360-title">{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {status}
        {actions ? <div className="crm-entity-360__actions">{actions}</div> : null}
      </header>

      {provenance.length > 0 ? (
        <dl className="crm-provenance-strip" aria-label="Источник и актуальность данных">
          {provenance.map((item) => (
            <div className="crm-provenance-strip__item" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="crm-entity-360__layout">
        <div className="crm-entity-360__facts">
          {sections.map((section) => (
            <section aria-labelledby={`crm-entity-section-${section.id}`} key={section.id}>
              <h2 id={`crm-entity-section-${section.id}`}>{section.title}</h2>
              <dl>
                {section.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd className={fact.sensitive ? "is-sensitive" : undefined}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        {timeline.length > 0 ? (
          <section className="crm-entity-360__timeline" aria-labelledby="crm-entity-timeline-title">
            <h2 id="crm-entity-timeline-title">История</h2>
            <ol>
              {timeline.map((item) => (
                <li key={item.id}>
                  <time dateTime={item.timestamp}>{item.timestamp}</time>
                  <h3>{item.title}</h3>
                  {item.body ? <p>{item.body}</p> : null}
                  <span>Источник: {item.sourceLabel}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </article>
  );
}
