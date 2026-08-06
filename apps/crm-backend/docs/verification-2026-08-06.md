# Приёмочное подтверждение — 2026-08-06

## Вердикт

Отдельное backend-приложение, OpenAPI-контракт, public intake лендинга, IAM/RBAC, CRM read/write,
operations API, runtime privilege boundaries и безопасный migration dry-run реализованы. Локальная
приёмка и изолированная runtime/DB-проверка на Bravo успешны. Production deploy, live edge switch и
canonical import намеренно не выполнялись: для них отсутствуют утверждённые secrets/providers,
свежий consistent snapshot и подписанные data decisions.

## Локальная автоматическая приёмка

- `pnpm verify && pnpm build` — успешно: 37 test files прошли, один guarded PostgreSQL file skipped;
  229 тестов прошли, два guarded integration tests skipped без `TEST_DATABASE_URL`.
- `pnpm audit --prod --audit-level=high` — известных production dependency vulnerabilities нет.
- `pnpm openapi:generate` — воспроизводимый OpenAPI 3.1 artifact пересоздан.
- `pnpm contracts:check` — 105 уникальных operations; crosswalk покрывает все CRM-01…CRM-13,
  operation registry и permission registry согласованы.
- Landing: `node --check` для `scripts/api-client.js` и `scripts/main.js`; 14/14 client contract tests
  прошли.

## PostgreSQL и Docker на Bravo

- Чистая PostgreSQL 16 получила 19 checksum migrations `0001_core…0140_crm_communication_permissions`.
  Повторный `db:migrate` вернул `applied=[]`.
- Все 19 down scripts выполнены в обратном порядке внутри одной transaction; состояние внутри
  transaction подтвердило rollback chain, затем выполнен `ROLLBACK`. Registry остался
  `19|0001_core|0140_crm_communication_permissions`.
- Реальный PostgreSQL integration suite для `QueueCommunication` прошёл 2/2 теста: атомарная
  постановка всех recipients, один outbox event, audit, exact idempotency replay, concurrency guard и
  row-scope/PII boundary.
- Runtime image `codex-kns-crm-backend:20260806-final`:
  `sha256:2cea701668c07b58a32ddead168140d2a973e1451164a06516232e6db7a77998`.
- Test/build image: `sha256:3219925c5648f09dc3f2a65f54500958295ae55dc89729426b818fda281d0090`;
  PostgreSQL image: `sha256:e29a8adeb572592245d17d893ce79fac19d38fda13a2d95f37a193f5e57b200b`.
- API запущен на Bravo с `user=node`, `uid=1000`, read-only root filesystem. `/health/live` и
  `/health/ready` вернули `200`; readiness подтвердил database и реальную write/delete probe object
  storage. Защищённый `/internal/v1/auth/session` без session вернул `401`.
- Логи подтвердили успешный bind на `:8080`, health requests `200`, отсутствие restart/OOM/error.

## End-to-end: landing → intake → CRM

В изолированной PostgreSQL/Bravo-проверке подтверждено:

1. Canonical upload вернул `201`; точный replay вернул `200`, тот же upload ID и binding token.
2. Неверный upload binding отклонён `422`; корректная application создана `201`.
3. Повторное использование binding отклонено `409`; несовпадение vacancy/sphere отклонено `422`.
4. Identity переиспользуется только при полном совпадении email + phone + normalized name + DOB;
   partial/conflict и повторный открытый route направляются в `needs_review` под advisory lock/DB
   invariant.
5. Durable reservation → stable object → finalize выдерживает replay; bounded stale reconciler в
   smoke забрал и удалил ровно один тестовый orphan.
6. Routing worker атомарно обрабатывает intake outbox через inbox dedupe и создаёт CRM aggregate,
   source link и audit без broad identity grants.
7. CRM mutations проверяют trusted Origin + CSRF; versioned mutations — также `If-Match`, create/
   queue commands — `Idempotency-Key`.

Все записи, учётные данные и объекты этого раздела были синтетическими и относились только к
изолированному QA-контуру.

## IAM, документы и внешняя доставка

- Пятая неуспешная MFA verification атомарно блокирует challenge; успешная verification создаёт
  session в той же transaction. Own/admin session lists используют signed cursor pagination.
- Candidate document content выдаётся только при `scan_state=clean` под row lock. Scanner provider
  не выдуман: production uploads остаются quarantined до утверждённой интеграции.
- Invite/reset credential worker хранит raw credential только в памяти, подписывает HTTPS request,
  имеет bounded retry/dead-letter и отдельную БД-роль. Без provider URL/secrets он fail-closed.
- `QueueCommunication` фиксирует только `queued_internal`/durable outbox. Реальная Email/MAX
  доставка не заявляется без выбранного provider и delivery receipt contract.

## Реальный migration dry-run

Полный MySQL dump восстановлен в изолированный MySQL 8 на Bravo. Общий privacy-safe прогон охватил
57 source tables и 438 424/438 424 row outcomes; ledger содержит только immutable digests/stable
reasons, unsafe raw source evidence — 0, canonical target writes — 0.

Для семи приоритетных tables добавлены deterministic versioned projections на том же immutable
dump (`SHA-256 7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`):

| Source scope | Rows | would_migrate | would_quarantine | would_conflict | would_exclude |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7 tables total | 14 368 | 8 732 | 2 807 | 2 202 | 627 |

Они породили 24 931 безопасный 1:N target intent, но target IDs/entities не создавались и
`canImport=false`. Это доказательство extraction/classification/idempotency, а не canonical
migration.

## Что блокирует production import и публикацию

1. Новый point-in-time-consistent MySQL snapshot, полный denominator и повторная hash/count сверка.
2. Подписанные решения по legacy leads/external links, ownership, duplicate merge, funnel mapping и
   разделению CRM/project tasks.
3. Transform/reconciliation для оставшихся source tables, отдельный transactional canonical unit of
   work, file-binary migration и staging rollback/replay proof.
4. Утверждённые scanner, Email/MAX communication и invite/reset credential delivery providers с
   credentials, signature/idempotency и retry/dead-letter contracts.
5. Подписанный contract/ТЗ artifact для юридической приёмки спорных требований.
6. Production secrets, операторский go/no-go, подключение общей edge-сети и live smoke после
   публикации.

До снятия этих gates CLI отвергает `--mode import`; HTTP import-команды отсутствуют. Скриншот не
применялся: изменение API-only и не содержит визуального web surface. Проверка выполнена через
OpenAPI, HTTP/negative-security smoke, PostgreSQL assertions, health и логи Bravo.
