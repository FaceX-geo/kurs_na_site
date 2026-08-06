# CRM backend: покрытие ТЗ и API-контрактов — 2026-08-06

## Граница работы

Это приложение реализует backend CRM, public intake лендинга, identity/RBAC, аудит, отчёты и
контролируемую миграцию Bitrix. Project tracker и AI-команды из общего ТЗ остаются отдельными
доменными приложениями и не смешиваются с `crm.task` или CRM permissions.

Статус `gate` означает не недописанный happy path, а намеренный запрет необратимого либо внешнего
действия до появления утверждённого решения, provider credentials или доказательств cutover.

## Матрица CRM-01…CRM-13

| Требование | Реализованный контракт | Состояние |
|---|---|---|
| CRM-01 Две воронки | `ListCases`, `ListCrmFunnels`, `GetCrmFunnel`; versioned state registry | реализовано |
| CRM-02 Переходы | `TransitionCase`; `If-Match`, guards, history, audit/outbox | реализовано |
| CRM-03 Карточка 360° | `GetCase`, `UpdateCase`, `GetCandidateSummary`, timeline; people, assignments, relocation, provenance | реализовано |
| CRM-04 Intake/source/UTM | `/public/v1/uploads`, `/public/v1/applications`; consent/source/attribution, отдельные idempotency keys | реализовано |
| CRM-05 Дедупликация | `ListDuplicateCandidates`, `MergeCandidate`; логическое обратимое объединение, employee guard | реализовано |
| CRM-06 «Арктический маяк» | `LinkRecommender`, `ReviewDocument`; append-only review/link history | реализовано; чтение файлов только после clean scan |
| CRM-07 Работодатели | list/get/create employer, list/get/create/transition referral; ИНН, contacts, owner, stage history | реализовано |
| CRM-08 Трудоустройство/переезд | typed relocation update в `UpdateCase`; plan/actual, household, support/result | реализовано; `post_relocation@1` остаётся draft |
| CRM-09 CRM tasks | list/get/create/update/transition; responsible, participants, checklist, priority/timezone, history | реализовано |
| CRM-10 Email/MAX | create/update/four-eyes approve + `QueueCommunication`; `If-Match`, idempotency, DB second-actor invariant, atomic recipient queue/audit/outbox | внутренняя durable queue реализована; внешний Email/MAX delivery provider — gate |
| CRM-11 Dashboard/notifications | scoped dashboard, cursor notifications, actor-only read mutation | реализовано |
| CRM-12 Семь групп отчётов | versioned run/list/get/export; pipeline, workload, referral outcomes, sources, employers, relocation, data quality | реализовано; export из сохранённого агрегата, ≤5 МБ |
| CRM-13 Settings | registered setting codes, immutable versions, activation, `If-Match`, global scope | реализовано |

## Сквозные инженерные контракты

- OpenAPI 3.1 генерируется из реально зарегистрированных Fastify routes.
- Каждый внутренний route имеет стабильный `operationId`, permission code и security requirement.
- Растущие реестры используют подписанную cursor pagination, а не offset.
- Mutation требует trusted Origin + CSRF; versioned mutation дополнительно требует `If-Match`.
- Create-команды используют `Idempotency-Key` и проверяют hash исходного запроса.
- Scope применяется в SQL до чтения/агрегации; PII field mask вычисляется по permission.
- Aggregate, history, audit и outbox изменяются одной PostgreSQL transaction.
- Queue communication не вызывает внешний provider синхронно: ответ означает только внутреннее
  `queued_internal`, а не фактическую доставку. Scope применяется до чтения draft/body/recipient IDs,
  включая idempotency replay.
- Runtime PostgreSQL роли API, worker и migrator разделены; API/worker не имеют DDL и не могут
  изменять append-only audit/history.
- Readiness сверяет checksum ledger со встроенным migration manifest read-only и fail-closed при
  pending/drift/empty/unavailable registry.
- Внутренние ответы маркируются `Cache-Control: no-store, private`.

## Миграция

Текущий dump разрешён для inspect/full dry-run. Production import остаётся закрыт до нового
consistent snapshot, полного denominator, решений по конфликтам и file-binary reconciliation.
Versioned transform registry обязан выдавать deterministic projection/target intents либо стабильную
quarantine reason; raw PII не сохраняется в ledger evidence.

## Внешние gates

1. Email/MAX: выбрать и утвердить provider, credentials, retry/dead-letter и delivery policy;
   `queued_internal` и approval не равны доставке.
2. Upload content: clean malware-scan verdict обязателен до скачивания/обработки документа.
3. Migration cutover: свежий snapshot, 7 lead dispositions, 2 external-link dispositions, files и
   подписанный go/no-go.
4. Юридическая приёмка: в checkout отсутствует подписанный договор/ТЗ artifact, на который ссылаются
   страницы 7–13 материалов.
