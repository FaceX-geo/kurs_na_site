# AGENTS.md — Kurs na Sever CRM Backend

## Зачем существует приложение

Backend превращает обращения с лендинга в управляемые CRM-кейсы и даёт сотрудникам единый,
наблюдаемый и безопасный API. Автоматизируются приём, нормализация, маршрутизация, контроль
повторов, миграционный ledger и технические проверки. Решения о доступах, конфликтах данных,
изменении воронок и production cutover остаются у ответственного человека.

## Границы приложения

- Это отдельное приложение в `apps/crm-backend`; лендинг остаётся самостоятельным static app.
- Same-origin edge обязан маршрутизировать `/public/v1`, `/api/v1`, `/internal/v1` и health routes
  в backend **до** SPA/static fallback.
- Public intake не принимает CRM cookie и не выдаёт внутренние данные.
- Внутренний CRM API использует server-side session, CSRF для mutations, RBAC и row scope.
- Legacy Bitrix — только источник миграции. Его парольные хэши, cookies, sessions, tokens,
  integration secrets и app passwords никогда не импортируются.

## Источники истины

При конфликте применяй порядок:

1. подписанный договор/ТЗ и решения process owner;
2. `docs/cabinet/generated/*.json|csv` как исполнимые versioned registries;
3. `docs/cabinet/*.md` как объяснение контрактов;
4. CRM PDF как UX/reference baseline, но не как runtime/security truth;
5. legacy DB как исторические данные, а не новая доменная модель.

Не выдумывай отсутствующее решение. Регистрируй draft/fail-closed и поднимай decision gate.

## Архитектурные правила

- `src/modules/*/contracts.ts` — транспортные контракты; `ports.ts` — порты; adapters — I/O.
- `src/composition.ts` — единственное место выбора concrete adapters.
- Все операции, permissions, словари и state machines проходят через versioned registries.
- Новый route получает стабильный `operationId`, schema response/error и contract test.
- List endpoints используют cursor pagination; offset запрещён для растущих реестров.
- Mutation использует optimistic version/`If-Match`, audit и outbox в одной транзакции.
- Внешние повторы защищаются idempotency key; consumer — inbox key.
- Никаких cross-module SQL из HTTP handler. SQL живёт в adapter/repository/worker.
- Не добавляй generic repository и абстракции без двух реальных вариантов использования.

## Безопасность и приватность

- Deny by default: неизвестная operation/permission/state/version не разрешается.
- Scope применяется в SQL до чтения; фильтрация загруженных строк в памяти запрещена.
- PII, credentials, MFA secret, session token, raw legacy row и полный payload не пишутся в лог.
- Session token, CSRF token, invite/reset/MFA challenge хранятся только в keyed hash форме.
- TOTP secret хранится только encrypted-at-rest; production key — 32 bytes из secret manager.
- PostgreSQL superuser не передаётся приложению: migrations/API/worker используют разные роли и
  разные credentials. Runtime-ролям запрещены DDL и mutation audit/schema-migration ledger.
- Credential delivery работает отдельным процессом и ролью `kurs_crm_credential_worker`. Ему нельзя
  выдавать общие runtime grants: только exact table/column grants из migration `0080`.
- Invite/reset raw credential выводится детерминированно из token UUID отдельным derivation secret
  только непосредственно перед HTTPS I/O. Не сохраняй и не логируй raw credential, request body,
  destination или provider error body; session pepper и webhook-signing secret не переиспользуй.
  Ротация derivation secret требует drain очереди либо revoke/reissue активных credentials.
- Privileged lifecycle/four-eyes/fresh MFA gates нельзя упрощать для удобства теста.
- Upload сначала попадает в quarantine; receipt не означает, что файл безопасен.
- Canonical upload возвращает `bindingToken`; `/public/v1/applications` принимает его только как
  `attachments.resumeFileBindingToken`. Raw token не хранится и не логируется: в `intake.upload`
  остаётся только keyed hash. Подключ выводится из `CREDENTIAL_DELIVERY_TOKEN_SECRET` с отдельным
  domain context; ротация root secret требует дождаться истечения/consumption всех 24-часовых upload
  bindings либо принудительно потребовать повторную загрузку.
- Object storage нельзя компенсировать в catch SQL-транзакции: COMMIT может быть успешным при
  потерянном acknowledgement. Сначала создавай durable `intake.upload_reservation`, затем stable-key
  object, затем finalize; удаление stale unreferenced objects принадлежит только bounded
  `pnpm uploads:reconcile`.
- `UPLOAD_MAX_BYTES` может уменьшать runtime-лимит, но не превышать exported
  `UPLOAD_STORAGE_CEILING_BYTES`. Потолок согласован с DB constraints, intake/Candidate360 schemas и
  object-store readers; повышать его можно только новой forward migration и contract-test изменением.
- Production secrets не коммитятся; `.env.example` содержит только имена и безопасные placeholders.

## Работа с данными и миграцией

- Не меняй уже применённый `*.up.sql`. Добавляй новую парную forward/down migration.
- Down migration запускается только с `ALLOW_DESTRUCTIVE_MIGRATION_DOWN=true` и явным решением.
- Immutable migration identity: `source_system=bitrix` + snapshot SHA-256 + source table + canonical
  source key digest + transform version.
- Dry-run не меняет canonical CRM entities; сохраняет только digest/stable reason metadata.
- `canImport=false` означает абсолютный запрет import. Не создавай staging bypass и не называй
  quarantine-classification «миграцией».
- Production cutover требует нового point-in-time-consistent snapshot и повторной сверки регистров.
- Raw dump/PII artifacts остаются только в private paths вне Git.

## Intake → CRM

- Canonical public base: `/public/v1`; `/api/v1` — deprecated compatibility alias.
- Каждая логическая запись получает отдельный Idempotency-Key; upload/application keys не смешивать.
- Routing worker создаёт person/profile/participation/source/case атомарно и отмечает source event inbox.
- Credential worker принимает только `identity.credential.delivery_requested`, использует inbox,
  детерминированный provider idempotency key, bounded exponential retry и durable `dead_lettered`.
  Новый provider реализуется через port; vendor-specific SDK в domain/worker не добавлять.
- Не объединяй автоматически две разные identity-кандидатуры. Отправляй submission в
  `needs_review` со стабильным reason code.
- Person разрешено переиспользовать только при полном совпадении email + phone + нормализованных ФИО
  + даты рождения и только для активного CRM profile без employee/user-account identity. Частичное
  совпадение и повторный открытый case того же profile/applicant route — `needs_review`.
- Изменение privacy text требует новой consent policy version на лендинге.

## Обязательные проверки

Перед передачей результата выполни из `apps/crm-backend`:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm openapi:generate
pnpm contracts:check
```

Для DB-изменений дополнительно: миграции на чистой PostgreSQL, повторный `db:migrate`, status,
API/worker smoke и проверка rollback SQL без фактического destructive rollback.

## Обязательный Bravo remote-build protocol

- Исходный код редактируется только локально на macOS. Локальный Docker Engine для проекта не
  используется.
- Любые `build`, `run`, `compose`, database, volume, logs и container health операции выполняются
  только на Bravo через явно указанный `docker --context remote-build ...`.
- После runtime-изменений собери затронутый сервис на Bravo, запусти или обнови нужный контур,
  дождись health/readiness и проверь логи. Локальная компиляция не заменяет этот gate.
- Если сервис имеет web surface и менялся визуально, открой именно Bravo development URL и сохрани
  screenshot фактического состояния вместе с логами. Для API-only изменения screenshot не заменяет
  HTTP/OpenAPI, DB и negative-security smoke; отсутствие UI-изменения фиксируется как not applicable.
- Используй уникальные временные имена и порты. Удаляй только созданные для текущей проверки test
  containers/images/artifacts. Запрещены `docker system prune`, `docker volume prune`,
  `docker compose down -v` и другие широкие destructive-команды без прямого разрешения человека.
- Не изменяй SSH config, Docker Contexts, адресные pools, edge-сети и другую инфраструктуру Bravo
  без явного поручения. Ошибка инфраструктуры документируется, а не «чинится» скрытым глобальным
  изменением.
- `CRM_EDGE_NETWORK` — существующая общая сеть landing edge; не заменяй её неявной project-local
  сетью. Production deploy/edge switch требует production secrets, операторского решения и live
  smoke; временная QA-сборка не является публикацией.
- Edge обязан перезаписывать клиентский `X-Forwarded-For`, а backend сохраняет только валидный
  `X-Request-ID`. Production config не имеет права принимать development placeholders, memory
  storage или plaintext S3.

## Git-протокол

- Сначала `git rev-parse --show-toplevel`, `git status --short --branch`, remote/refspec.
- Сохраняй чужие dirty/untracked изменения; индексируй только точные task paths.
- Не применяй `git add -A`, destructive reset/checkout и broad search по `/Volumes`.
- Перед switch/pull/rebase в dirty tree нужен safety stash с понятным именем.
- Commit/push/deploy выполняй только в запрошенном scope и подтверждай SHA/route/health.

## Human gates

Без решения владельца процесса нельзя:

- принимать спорную трактовку договора/ТЗ;
- активировать draft funnel или менять его state graph;
- автоматически разрешать duplicate/ownership/legacy actor conflicts;
- включать production import/cutover;
- назначать критические роли, делать MFA reset или обходить two-person control;
- публиковать новую privacy policy/retention policy.
- активировать credential delivery до обмена HTTPS webhook signing secret и подтверждения provider
  idempotency/signature contract.
- считать `queued_internal` фактической Email/MAX доставкой либо подключать communication provider
  без утверждённых credentials, receipts и retry/dead-letter contract;
- помечать upload как `clean` без утверждённого malware scanner verdict и signature policy.

## Definition of Done

Готово означает: явный contract, migration, tests, generated OpenAPI, negative security checks,
observability, documented operator action и реальное smoke-доказательство. «Скомпилировалось» — не
доказательство готового backend.
