# Аудит источников перед реализацией — 2026-08-06

## Вердикт

Материалов достаточно для backend architecture, OpenAPI и реального migration dry-run. Текущий
legacy dump **не является доказанным point-in-time snapshot**, а registries содержат пять import
issues: четыре blocking condition и отдельное предупреждение о fresh cutover snapshot; поэтому
production import/cutover должен оставаться fail-closed.

## Проверенные источники

- `sitemanager-final.sql.gz`: MySQL 8.0.40 dump, SHA-256
  `7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`.
- `docs/cabinet/*` и `docs/cabinet/generated/*`: technical, auth, state, field, migration contracts.
- `output/pdf/kurs-na-sever-crm-complete-interfaces-v5.pdf`: 52-page static UX baseline.
- landing client and live same-origin behavior.

## Legacy DB

Safe metadata inventory: 1,669 tables, 13,690 columns, 1,353,224 tuples; в новом migration scope —
57 source tables и 438,424 expected row outcomes. Ключевые объёмы: 218 users, 3,186 contacts,
797 companies, 1,899 deals, 1,808 employer directions, 7,737 activities, 105,490 events,
67,857 timeline rows, 89 tasks и 3,941 file metadata rows.

Dump содержит 1,669 balanced `LOCK/UNLOCK TABLES`, но не содержит transaction/GTID/binlog boundary.
Binary `/upload` content отсутствует. Пароли/tokens/secrets присутствуют в legacy domain и должны
быть исключены, отозваны и перевыпущены, а не перенесены.

Зафиксированные data-quality queues: 383 deals без person proof, 1,002 participants без deal,
13 incomplete employer directions, 219 duplicate clusters/571 contacts, 21 dual-use tasks,
3 broken task references, 1 organization conflict, 617 objects с inactive owner,
687 stage-history conflicts и 13,670 quarantined supposed-history rows.

## Registry audit

Machine validator подтвердил внутренние ссылки: 137 authorization permissions, 46 transition refs,
57 requirement rows, 57 migration tables, 115/115 source fields и 33 references.

Import блокируют:

1. Решение по 7 legacy leads отсутствует в signed disposition coverage.
2. 2 external-link security decisions не включены в атомарный ledger.
3. Manifest/disposition denominator расходится на 2 строки (438,424 против 438,426).
4. Dump имеет per-table locks, но не имеет global transaction/replication watermark и потому не
   является point-in-time snapshot.

Дополнительный cutover gate: после исправления registries нужен свежий consistent snapshot и
утверждённые executable canonical transforms. `source_system=bitrix` уже согласован во всех
исполняемых registries и больше не является blocker.

## PDF/TЗ

PDF визуально проверен по всем страницам и не содержит form/JS/attachment payload. Он определяет
информационную архитектуру и UX, но не OpenAPI, runtime auth и migration truth. Выявлены drift:

- PDF требует MAX MFA для каждого сотрудника, engineering contract — TOTP для privileged roles;
- PDF упоминает DeepSeek, provider contract не утверждён;
- старые queue counts (385/7) расходятся с актуальными verified counts (383/13);
- post-relocation показан в UI, но process owner ещё не утвердил state machine.

Backend разрешает это через versioned provider/state registries; `post_relocation@1` остаётся draft.

В checkout нет подписанного contract/TЗ artifact, хотя документы ссылаются на его страницы 7–13.
Это не блокирует backend prototype, но блокирует финальную юридическую приёмку спорных требований.

## Landing integration

До backend edge route `/api/v1/*` возвращал landing HTML. Контракт исправлен на canonical
`/public/v1`, compatibility `/api/v1`, cookie-free calls, stable Idempotency-Key и JSON errors.
Production edge обязан направлять API locations до static `location /`.

## Решение

Разрешено: schema migrations в чистую target DB, API/worker smoke, restore dump в изолированную
MySQL, полный real dry-run с privacy-safe ledger, conflict triage.

Запрещено до снятия gates: canonical rehearsal import, production cutover, автоматическое разрешение
duplicate/ownership conflicts, перенос legacy credentials и объявление quarantine outcomes
«успешной миграцией».

Фактический результат полной репетиции и проверок зафиксирован в
[`verification-2026-08-06.md`](verification-2026-08-06.md).
