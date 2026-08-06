# Курс на Север — CRM Backend

Отдельное Fastify/PostgreSQL-приложение для приёма лидов с лендинга, внутренней CRM, identity/RBAC,
аудита и контролируемой миграции Bitrix. Контракты публикуются как OpenAPI 3.1, бизнес-переходы и
permissions задаются реестрами, запись защищена idempotency/optimistic locking.

## Контуры

- `/public/v1/*` — cookie-free intake лендинга; `/api/v1/*` — deprecated alias.
- `/internal/v1/auth/*` — server-side sessions и MFA.
- `/internal/v1/crm/*` — кейсы, люди, работодатели, направления, задачи, timeline, справочники.
- `/health/live`, `/health/ready` — liveness/readiness.
- worker — durable `intake.application.received.v1` → CRM case routing через outbox/inbox.
- upload-reconciler — bounded cleanup просроченных durable upload reservations/orphan objects.
- credential-worker — отдельная доставка invite/reset credentials через подписанный HTTPS webhook,
  inbox-idempotency и конечный retry/dead-letter.
- migration CLI — inspect/plan/preflight/real dry-run ledger; import fail-closed до снятия gates.

Подробности: [архитектура](docs/architecture.md), [аудит входных материалов](docs/source-audit-2026-08-06.md),
[матрица покрытия CRM API](docs/crm-api-coverage-2026-08-06.md),
[приёмочные доказательства](docs/verification-2026-08-06.md),
[hardening public intake](docs/intake-hardening-2026-08-06.md),
[правила для следующих агентов](AGENTS.md).

## Локальная разработка и Bravo runtime

Локально требуются Node.js 22+ и pnpm 11. Здесь редактируется исходный код и выполняются только
не-Docker проверки:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

Все Docker, Compose, PostgreSQL и runtime операции этого workspace выполняются только на Bravo.
Следующая команда допустима только для нового изолированного development/QA-контура без
production-данных:

```sh
docker --context remote-build compose -f apps/crm-backend/compose.yaml config
docker --context remote-build compose -f apps/crm-backend/compose.yaml up --build
```

На production общий `compose up`, `up --build`, `down` и `down -v` запрещены: они могут затронуть
PostgreSQL и именованные volumes. Release image собирается только из `git archive <exact-sha>` или
чистого detached worktree. Затем отдельно выполняются `run --rm --no-deps migrate`, два
reconciliation-run и только после успешного gate — targeted
`up -d --no-deps --force-recreate api worker`. PostgreSQL container ID и volume ID до и после
rollout должны совпасть.

Production запуск требует secret manager/CI variables и существующую edge-сеть. Не копируй
production secrets в локальный `.env` и не запускай проектный Docker на macOS. Полный обязательный
порядок backup/restore proof → exact-SHA build → migration/reconciliation → targeted rollout →
health/logs/HTTP smoke описан в [AGENTS.md](AGENTS.md).

Swagger UI включён вне production на `/docs`. Стабильный artifact создаётся командой:

```sh
pnpm openapi:generate
pnpm contracts:check
```

Compose требует уже созданную общую edge-сеть из `CRM_EDGE_NETWORK`. API подключается ролью
`kurs_crm_api`, worker — `kurs_crm_worker`, credential-worker — `kurs_crm_credential_worker`,
миграции — `kurs_crm_migrator`; bootstrap-superuser
`postgres` не передаётся приложению. Роли создаются только при инициализации нового PostgreSQL volume
скриптом `deploy/postgres-init/10-runtime-roles.sh`, встроенным в database image, а migration
`0050_runtime_role_grants` выдаёт базовые grants, `0080_credential_delivery_runtime` изолирует
credential delivery, а `0130_runtime_least_privilege` отзывает broad/default grants worker и
оставляет exact verbs только для routing-контура. `0140_crm_communication_permissions` разделяет
permissions подтверждения и постановки коммуникации в очередь и закрепляет second-actor invariant.
Старый volume нельзя считать обновлённым автоматически: роль `kurs_crm_credential_worker` должна
быть создана проверенным additive role-provisioning run **до** применения `0080`, иначе migration
fail-closed; альтернатива — новый восстановленный volume.

Пароли ролей для URI генерируй в base64url/hex без `:`, `/`, `@`, `%` и не сохраняй в `.env` на
production-хосте. `CRM_EDGE_NETWORK` должен указывать на сеть, к которой уже подключён landing NGINX.

Не передавай production secrets через shell history. Для реального окружения используй secret
manager/CI variables и отдельные сильные ключи для cursor, session, credential derivation,
credential webhook signing, MFA и PII hashing. Derivation и signing secrets не должны совпадать.

Production-конфигурация fail-closed: development placeholders, in-memory object storage и HTTP S3
endpoint отклоняются при старте. `/health/ready` делает реальную write/delete-пробу quarantine storage.
Database readiness read-only сверяет встроенный migration manifest с `platform.schema_migration` и
возвращает `503` при pending migration, checksum drift, пустом либо недоступном registry; API не
создаёт таблицы и не меняет ledger на health path.
Одноразовый `storage-init` чинит owner/mode как нового, так и уже существующего quarantine volume;
API не стартует, пока эта проверяемая подготовка не завершилась успешно.

## Upload lifecycle и обслуживание

Canonical `/public/v1/uploads` возвращает одноразовый 24-часовой `bindingToken`; application
передаёт его в `attachments.resumeFileBindingToken`. Raw token не хранится и не логируется. Upload
использует durable DB reservation → stable object key → atomic finalize, поэтому потерянный ответ
после COMMIT не приводит к удалению уже подтверждённого объекта. Runtime-лимит не может превышать
единый `UPLOAD_STORAGE_CEILING_BYTES` (10 MiB), согласованный с DB и OpenAPI.

Просроченные неподтверждённые reservations убирает только idempotent one-shot reconciler. Его нужно
включить в trusted scheduler/cron; Compose предоставляет явный maintenance profile:

```sh
docker --context remote-build compose -f apps/crm-backend/compose.yaml \
  --profile maintenance run --rm upload-reconciler
```

Параметры `UPLOAD_RECONCILE_STALE_HOURS`, `UPLOAD_RECONCILE_RETRY_MINUTES` и
`UPLOAD_RECONCILE_BATCH_SIZE` имеют жёсткие bounds. Повышение storage ceiling требует forward DB
migration и обновления contract tests, а не только env-переменной.

## CRM-коммуникации

После four-eyes confirmation операция `QueueCommunication` требует `If-Match`,
`Idempotency-Key`, trusted Origin и CSRF. Draft, все recipients, audit, один outbox event и
idempotency result фиксируются одной PostgreSQL transaction. Ответ `queued_internal` означает только
durable внутреннюю очередь и никогда не выдаётся за Email/MAX delivery. Внешний provider, его
credentials, retry/dead-letter и delivery receipts остаются human gate.

## Доставка invite/reset credentials

API сохраняет только keyed hash одноразового credential и публикует в outbox его UUID. Отдельный
worker реконструирует credential из UUID и `CREDENTIAL_DELIVERY_TOKEN_SECRET` только в памяти,
после чего отправляет generic HTTPS POST. Raw credential запрещён в БД, outbox, inbox, receipt,
логах и метриках; он существует только в памяти процесса и TLS request body.

Webhook получает `credential-delivery.webhook.v1`; подпись `v1=<hex hmac-sha256>` передаётся в
`X-Kurs-Delivery-Signature` и считается от `<X-Kurs-Delivery-Timestamp>.<raw JSON body>` отдельным
`CREDENTIAL_DELIVERY_SIGNING_SECRET`. Provider обязан проверять HTTPS/signature/timestamp и
идемпотентно дедуплицировать `Idempotency-Key`/`X-Kurs-Delivery-Id`. Response body игнорируется;
опциональный безопасный reference читается только из `X-Provider-Delivery-Id`.

`CREDENTIAL_DELIVERY_TOKEN_SECRET` нельзя ротировать как обычный stateless ключ: сначала нужно
дождаться обработки очереди либо отозвать и перевыпустить все активные invite/reset tokens. Иначе
worker реконструирует credential, не совпадающий с hash, созданным API до ротации.

Retry экспоненциальный и ограничен `CREDENTIAL_DELIVERY_MAX_ATTEMPTS`; terminal failure хранится как
`identity.credential_delivery.state=dead_lettered` со стабильным безопасным error code. Пока владелец
не предоставил HTTPS endpoint, не обменял signing secret и не подтвердил idempotency/signature
contract, provider onboarding остаётся human gate. Без URL/secrets credential-worker явно откажется
стартовать; включать его «в пустоту» нельзя. Compose-сервис находится в профиле
`credential-delivery` и после закрытия gate включается только явно:

```sh
docker --context remote-build compose -f apps/crm-backend/compose.yaml \
  --profile credential-delivery up -d credential-worker
```

## Миграция legacy

```sh
pnpm migration:preflight
pnpm exec tsx scripts/migrate-legacy.ts plan
LEGACY_MYSQL_URL=... DATABASE_URL=... pnpm migration:run -- --mode dry-run
```

Проверка семи versioned classifiers и безопасная rehearsal описаны в
[canonical transform foundation](../../docs/migration/canonical-transform-foundation.md).
`--mode import` намеренно заблокирован, пока preflight не подтвердит новый consistent snapshot,
полный denominator, подписанные data decisions и отдельный transactional canonical import path.
Этот gate нельзя обходить.

## Edge-интеграция

Сначала подключается [nginx snippet](deploy/nginx-crm-locations.conf), затем static landing fallback.
Это предотвращает прежнее поведение, когда `/api/v1/*` возвращал HTML лендинга вместо JSON.
