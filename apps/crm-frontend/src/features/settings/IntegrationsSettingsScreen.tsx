import {
  IconAlertTriangle,
  IconBrain,
  IconCheckupList,
  IconLogin,
  IconMail,
  IconMessageCircle,
  IconWorld,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { PageHeader, StateMessage, StatusPill } from "@/shared/ui";
import "./settings.css";

interface ConnectionFixture {
  id: string;
  label: string;
  summary: string;
  owner: string;
  fixtureState: string;
  detail: string;
  icon: ReactNode;
}

const CONNECTIONS: readonly ConnectionFixture[] = [
  {
    id: "mail",
    label: "Почта",
    summary: "Яндекс 360 · входящая и исходящая синхронизация",
    owner: "Ольга Лебедева",
    fixtureState: "UI fixture · не provider proof",
    detail:
      "Интерфейс предусматривает Яндекс 360, VK WorkSpace / Mail.ru, Р7-Офис и корпоративный IMAP + SMTP.",
    icon: <IconMail aria-hidden size={23} />,
  },
  {
    id: "max-messages",
    label: "MAX — сообщения",
    summary: "Черновики и внутренняя очередь сообщений",
    owner: "CRM-администратор",
    fixtureState: "Provider endpoint отсутствует",
    detail: "Текущий OpenAPI не даёт configure/test/status endpoint для MAX-провайдера.",
    icon: <IconMessageCircle aria-hidden size={23} />,
  },
  {
    id: "max-login",
    label: "MAX — вход",
    summary: "Обязательный второй фактор для human accounts",
    owner: "Служба безопасности",
    fixtureState: "Provider endpoint отсутствует",
    detail: "20 сотрудников должны зарегистрировать фактор; 198 service identities не участвуют.",
    icon: <IconLogin aria-hidden size={23} />,
  },
  {
    id: "intake",
    label: "Заявки с публичного сайта",
    summary: "Intake заявок в CRM",
    owner: "Ольга Лебедева",
    fixtureState: "UI fixture · runtime не доказан",
    detail:
      "Экран показывает boundary интеграции, но не утверждает, что provider health доступен из текущего OpenAPI.",
    icon: <IconWorld aria-hidden size={23} />,
  },
  {
    id: "assistant",
    label: "Помощник",
    summary: "Server-side gateway · обезличенный контекст",
    owner: "CRM-администратор",
    fixtureState: "Provider endpoint отсутствует",
    detail:
      "Секрет модели не показывается. Права помощника ограничены effective access сотрудника.",
    icon: <IconBrain aria-hidden size={23} />,
  },
];

export function IntegrationsSettingsScreen() {
  const [selectedId, setSelectedId] = useState(CONNECTIONS[0]?.id ?? "");
  const [checkRequested, setCheckRequested] = useState<string | null>(null);
  const selected = CONNECTIONS.find((connection) => connection.id === selectedId) ?? CONNECTIONS[0];

  if (!selected) return null;

  return (
    <div className="settings-screen integrations-settings-screen">
      <PageHeader
        title="Подключения"
        description="Каналы связи, входа, intake и помощника — без показа секретов и выдуманных provider-статусов."
      />

      <StateMessage
        state="stale"
        icon={<IconAlertTriangle aria-hidden size={24} />}
        title="Provider endpoints отсутствуют"
        message="В текущем backend OpenAPI нет операций configure/test/status для почты, MAX или DeepSeek. Все значения ниже — интерфейсные fixtures; они не доказывают подключение, приём провайдером или доставку."
      />

      <div className="integrations-layout">
        <section className="integrations-list" aria-labelledby="integrations-list-title">
          <h2 id="integrations-list-title">Каналы</h2>
          <ul>
            {CONNECTIONS.map((connection) => (
              <li
                className={connection.id === selected.id ? "is-selected" : undefined}
                key={connection.id}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(connection.id);
                    setCheckRequested(null);
                  }}
                >
                  <span className="integrations-list__icon">{connection.icon}</span>
                  <span className="integrations-list__copy">
                    <strong>{connection.label}</strong>
                    <span>{connection.summary}</span>
                  </span>
                  <StatusPill status="gap" label="Контрактный разрыв" tone="attention" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className="integrations-detail" aria-labelledby="integrations-detail-title">
          <header>
            <span className="integrations-detail__icon">{selected.icon}</span>
            <div>
              <p>Выбранное подключение</p>
              <h2 id="integrations-detail-title">{selected.label}</h2>
              <span>{selected.summary}</span>
            </div>
          </header>

          <dl>
            <div>
              <dt>Интерфейсный статус</dt>
              <dd>{selected.fixtureState}</dd>
            </div>
            <div>
              <dt>Владелец</dt>
              <dd>{selected.owner}</dd>
            </div>
            <div>
              <dt>Секреты</dt>
              <dd>Скрыты server-side</dd>
            </div>
            <div>
              <dt>Последняя runtime-проверка</dt>
              <dd>Недоступна в контракте</dd>
            </div>
          </dl>

          <p className="integrations-detail__description">{selected.detail}</p>

          {selected.id === "mail" ? (
            <section
              className="integrations-providers"
              aria-labelledby="integrations-providers-title"
            >
              <h3 id="integrations-providers-title">Разрешённые варианты почты РФ</h3>
              <ul>
                <li>Яндекс 360</li>
                <li>VK WorkSpace / Mail.ru</li>
                <li>Р7-Офис</li>
                <li>Другой российский или корпоративный IMAP + SMTP</li>
              </ul>
            </section>
          ) : null}

          {checkRequested === selected.id ? (
            <StateMessage
              state="validation"
              icon={<IconCheckupList aria-hidden size={22} />}
              title="Проверка не запущена"
              message="Нужен versioned provider endpoint. Интерфейс не имитирует успешный health-check и не читает секреты напрямую."
            />
          ) : null}

          <button
            type="button"
            className="crm-button crm-button--quiet"
            onClick={() => setCheckRequested(selected.id)}
          >
            <IconCheckupList aria-hidden size={19} />
            Проверить подключение
          </button>
        </aside>
      </div>
    </div>
  );
}
