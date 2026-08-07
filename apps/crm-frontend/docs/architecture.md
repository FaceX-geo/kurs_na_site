# Архитектура CRM frontend

## Цель

Система должна давать специалисту одно понятное рабочее место: увидеть
отклонение, открыть доказанную карточку, принять решение и получить квитанцию
результата. Повторяемые загрузка, фильтрация, синхронизация, проверки версий и
обработка состояний выполняются системой. Смысл изменения, исключения и
подтверждение критичного действия остаются у человека.

## Контуры

CRM frontend — самостоятельное приложение в `apps/crm-frontend`. Он использует
backend только через версионированный OpenAPI `apps/crm-backend/openapi/openapi.json`.
Landing и отдельный Tracker не являются источниками runtime-кода, маршрутов,
данных или доменной модели.

```text
route / feature
    ↓ controlled props and user intent
shared UI
    ↓ typed command/query request
shared API generated from OpenAPI
    ↓ HTTP contract
CRM backend
    ↓ result, version and evidence
feature state → receipt / recovery state
```

### Route и feature

- владеют URL, загрузкой данных, permissions и orchestration;
- собирают backend DTO в явную view model;
- передают в UI только разрешённые пользователю значения;
- не придумывают отсутствующий backend endpoint.

### Shared API

- generated types получают только из текущего OpenAPI;
- auth, CSRF, idempotency, version/conflict и error mapping находятся здесь, а
  не размазываются по компонентам;
- сетевой ответ не считается успешным бизнес-результатом без ожидаемого outcome.

### Shared UI

- не выполняет fetch и не хранит права доступа;
- получает controlled inputs и возвращает пользовательское намерение;
- различает `loading`, `empty`, `error`, `validation`, `stale`, `denied`,
  `conflict`, `archived`;
- цвет всегда дублируется текстом, номером или status label;
- публичный импорт проходит через `@/shared/ui`.

### UI Registry

`registry/` связывает reference screen, компонент и точный backend `operationId`.
Статусы контракта:

- `connected` — сценарий покрыт проверенными backend operations;
- `partial` — есть честно обозначенная рабочая часть и известный недостающий
  outcome;
- `contract-gap` — backend-контракта нет, `operationIds` остаётся пустым;
- `not-applicable` — демонстрационная системная поверхность без backend.

## Изменения данных

Критичные и повторяемые операции проходят единый цикл:

1. `draft` — человек формирует намерение;
2. `preview` — система валидирует и показывает последствия без mutation;
3. `confirm` — человек подтверждает конкретный рассчитанный набор;
4. `execute` — API выполняет точную operation с требуемой версией и
   idempotency metadata;
5. `receipt` — UI показывает outcome и доказательства, доступные по контракту.

Повтор после частичного результата всегда начинается с нового preview и только
для retryable элементов. `queued` не называется `delivered`, пока backend не
вернул доказательство провайдера.

## Доступ и приватность

- route guard улучшает UX, но backend остаётся источником authorization;
- скрытые записи, их поля и агрегаты не вычисляются на клиенте;
- auth screens 45–48 изолированы от CRM shell и не читают CRM endpoints;
- пользовательский текст не показывает raw protocol headers, секреты или stack;
- чувствительные значения маскируются до попадания в presentation-компонент.

## Наблюдаемость

UI-квитанция может хранить технический `operationId`, request/receipt IDs в
структурированных evidence-полях, но не подменяет ими понятный outcome для
человека. Ошибка сохраняет контекст preview и даёт только безопасное разрешённое
действие восстановления.

## Масштабирование

Новый экран добавляется как композиция существующего recipe. Новый компонент
допустим, когда меняется контракт взаимодействия, а не только расположение.
Новый backend сценарий сначала появляется в OpenAPI; после этого registry check
разрешает связать его с экраном.
