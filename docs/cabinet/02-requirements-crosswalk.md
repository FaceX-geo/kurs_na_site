# Матрица требований и доказательств

Статус: implementation baseline
Дата: 29.07.2026

Machine-readable evidence contract: [generated/requirements-crosswalk.csv](generated/requirements-crosswalk.csv). Он содержит route/surface, operation, positive/forbidden test ID, persisted/audit evidence, migration query и visual reference для каждой строки.

Нормативные каталоги:

- [authorization policy](generated/authorization-policy-catalog.json);
- [state transitions](generated/state-transition-catalog.json);
- [migration scope manifest](generated/migration-scope-manifest.json).
- [source fields/funnels/bindings](generated/source-field-map.json).

## 1. Правило приёмки

Каждая строка считается выполненной только при наличии всех применимых доказательств:

- работающий экран/состояние;
- успешный API/domain test;
- отрицательная проверка прав;
- persisted data/result;
- audit event;
- визуальное сравнение с утверждённым референсом;
- migration/reconciliation query, если строка касается legacy-данных.

PNG, HTML без сохранения, HTTP `200` и ручное устное подтверждение по отдельности не являются доказательством.

## 2. Сквозная матрица

| ID | Требование | Класс | Экран/сценарий | Доказательство |
|---|---|---|---|---|
| CAB-01 | Единый внутренний shell для CRM, tracker, AI и разрешённого администрирования | `CONTRACT` + `USER-EXPANSION` | FND-01 | Route inventory; role-aware navigation; keyboard; responsive |
| CAB-02 | Публичный сайт не является модулем кабинета | `OUT-OF-SCOPE` | shell/settings | В sidebar нет «Сайт»; только «Интеграция сайта» у CRM admin; public files не переписаны |
| AUTH-01 | Безопасный вход | `ENGINEERING-CONTROL` | AUTH-01 | Valid/invalid/locked/rate-limit tests; JSON API; audit |
| AUTH-02 | MFA для привилегированных ролей | `ENGINEERING-CONTROL` | AUTH-02 | Enroll/verify/recovery/failed tests; secrets absent from logs |
| AUTH-03 | Одноразовое восстановление пароля | `USER-EXPANSION` + `ENGINEERING-CONTROL` | AUTH-03 | Equal response, expiry/reuse/revoke, session revoke, audit |
| SA-01 | Реестр пользователей | `USER-EXPANSION` | ADM-01 | Search/filter/status/roles/source; persisted create/invite |
| SA-02 | Lifecycle пользователя | `USER-EXPANSION` | ADM-01/03 | Activate/lock/disable/invite/reset; impact preview; audit |
| SA-03 | Независимые роли и scopes | `USER-EXPANSION` + `ENGINEERING-CONTROL` | ADM-02 | Явные assign/revoke CRM/project/migration/audit; effective preview; UI + direct URL/API `403`; reason/version/session recalculation; before/after audit |
| SA-04 | Защита last superadmin/self-escalation | `ENGINEERING-CONTROL` | ADM-02 | Negative tests; second approval; no partial change |
| SA-05 | Password/MFA/session operations | `USER-EXPANSION` + `ENGINEERING-CONTROL` | ADM-03/04 | No current password; reset/force change/revoke; notification; audit |
| AUD-01 | Полный append-only audit log | `USER-EXPANSION` + `ENGINEERING-CONTROL` | ADM-05 | DB update/delete denied; filters/detail/export; integrity |
| AUD-02 | Redaction | `ENGINEERING-CONTROL` | ADM-05 | Automated scan: passwords/tokens/MFA secrets/full PII absent |
| CRM-01 | Две независимые воронки | `CONTRACT` | CRM-02/03 | List+kanban; separate definitions; counts equal DB |
| CRM-02 | Контролируемые переходы | `CONTRACT` + `ENGINEERING-CONTROL` | CRM-02/03 | State-machine tests; required fields/reasons; version conflict |
| CRM-03 | Карточка 360° | `CONTRACT` | CRM-04/05 | Summary + timeline + four tabs; persistence and history |
| CRM-04 | Intake, source и UTM | `CONTRACT` | CRM-04 | Public API contract; consent/source saved; idempotency |
| CRM-05 | Дедупликация | `CONTRACT` + `ENGINEERING-CONTROL` | CRM-04 | Exact/fuzzy cases; no hidden merge; reviewer reason/audit |
| CRM-06 | «Арктический маяк» | `CONTRACT` | CRM-05 | Unique code; bidirectional link; document status/reason |
| CRM-07 | Работодатели | `CONTRACT` | CRM-05/06 | INN normalization; contacts; referrals; result history |
| CRM-08 | Трудоустройство и переезд | `CONTRACT` | CRM-05 | Required completion fields; plan/actual dates; household |
| CRM-09 | CRM tasks | `CONTRACT` | CRM-07 | CRUD; list/kanban same set; responsible/status/due/history |
| CRM-10 | Email/Max/timeline | `CONTRACT` | CRM-08 | Outbox; retry; delivery failure; no duplicate message/event |
| CRM-11 | Персональный dashboard/notifications | `CONTRACT` | CRM-01 | Role scope; today/week/overdue/relocation counts; drill-down |
| CRM-12 | Семь групп отчётов | `CONTRACT` | CRM-09 | Formula version; filters/freshness; source query; export rights |
| CRM-13 | CRM settings | `CONTRACT` | CRM-10 | Funnel/fields/CRM roles/integrations; no platform account control |
| PM-01 | Иерархия направления/проекты/задачи | `CONTRACT` | PM-01/02/03 | Tree; no cycles; archive; move history |
| PM-02 | Полная карточка project task | `CONTRACT` | PM-03 | Fields, responsible/executors, subtasks/files/comments/history |
| PM-03 | Contract statuses/priorities | `CONTRACT` | PM-03/04 | Four stored states; overdue computed badge; transition tests |
| PM-04 | List/Kanban/Gantt | `CONTRACT` | PM-02/03/04 | Identical task set; planned/actual; dependencies |
| PM-05 | Workload/plan-fact/dashboard | `CONTRACT` | PM-01/02 | Versioned formula; source query; drill-down |
| PM-06 | Независимые project roles | `CONTRACT` | PM-05 | Four roles; direction/project/self scopes; direct API negatives |
| PM-07 | Portal/Max notifications tracker | `CONTRACT` | PM-05/FND-01 | Event matrix; permission-safe deep link; idempotent delivery/retry |
| PLT-01 | CRM task и project task — разные сущности | `CONTRACT` | CRM-07/PM-03 | Separate schema/API/permission; AI must choose contour |
| AI-01 | Единый текстовый помощник в CRM и tracker | `CONTRACT` | AI-01/02 | Context visible; permissions inherited; sources linked |
| AI-02 | Создание одной задачи простой фразой | `USER-EXPANSION` | AI-01 | Draft → validate → preview → confirm → persisted task/audit |
| AI-03 | Массовые черновики задач | `USER-EXPANSION` + `ENGINEERING-CONTROL` | AI-04 | Selection preview; separate confirm; per-item result; retry errors |
| AI-04 | Отчёт обычным языком | `USER-EXPANSION` | AI-03 | Parsed params; formula version; equality with standard report |
| AI-05 | Безопасность AI | `ENGINEERING-CONTROL` | AI-01..04 | No raw SQL/hidden rights; injection tests; confirm gate |
| AI-06 | Fallback без AI | `ENGINEERING-CONTROL` | AI error state | Manual task/report works; no partial hidden write |
| MIG-01 | Контроль snapshot/run/dry-run | `CONTRACT` + `ENGINEERING-CONTROL` | MIG-01 | Checksum; immutable source; run state; restart/idempotency |
| MIG-02 | Conflict/reject queue | `CONTRACT` | MIG-02 | Typed reason; owner; before/after; resolution audit |
| MIG-03 | Reconciliation/cutover/rollback | `ENGINEERING-CONTROL` | MIG-03 | 100% ledger; zero blocking issues; rehearsal; signed go/no-go |
| MIG-04 | Все 218 source users классифицированы | `USER-EXPANSION` + `ENGINEERING-CONTROL` | MIG-04 | Exactly one outcome per source ID; no automatic mass activation |
| MIG-05 | Сотрудники и historical actors | `USER-EXPANSION` | MIG-04 | Active/inactive/service separated; invite state; legacy actor |
| MIG-06 | Связи сотрудников с кандидатами | `USER-EXPANSION` + `ENGINEERING-CONTROL` | MIG-04 | Relation-type reconciliation; target or explained outcome; orphan=0 |
| MIG-07 | Контакты/дела/работодатели/направления/история | `CONTRACT` | MIG-01..04 | Source/target counts, ledger, relation queries, signed samples |
| MIG-08 | Legacy secrets не перенесены | `ENGINEERING-CONTROL` | MIG evidence | Transform staging/artifacts/target scan = 0; raw quarantine isolated/denylisted |
| MIG-09 | Файлы | `CONTRACT` + `ENGINEERING-CONTROL` | MIG-03 | `/upload` checksum/coverage or explicit blocking missing-binary ledger |
| UX-01 | Соответствие стилю «Курс на Север» | `CONTRACT` + `USER-EXPANSION` | all | Same viewport reference/prototype composite, iterative diff |
| UX-02 | Понятность новичку | `USER-EXPANSION` | core tasks + AI | Moderated acceptance: create task/report without IDs or prompt syntax |
| UX-03 | Service states | `ENGINEERING-CONTROL` | all registries/details | loading/empty/stale/validation/denied/error/conflict/archived |
| UX-04 | Accessibility/responsive | `ENGINEERING-CONTROL` | RSP-01 + new screens | WCAG AA audit; keyboard; 44 px; no critical horizontal scroll |
| BRAND-01 | Текстовый logo + Rose of North | `USER-EXPANSION` | brand review | 3 ImageGen concepts; written choice; master/light/dark/compact |
| OPS-01 | Health/readiness/monitoring | `ENGINEERING-CONTROL` | admin/ops evidence | API JSON health; DB/outbox/storage/integration metrics |
| OPS-02 | Backup/restore | `ENGINEERING-CONTROL` | evidence | Encrypted backup; restore test; RPO/RTO measurement |
| DOC-01 | Исходники и документация | `CONTRACT` | delivery pack | Architecture/schema/OpenAPI/admin-user guides/processes/screens |
| ACC-01 | Нет S0/S1 | `CONTRACT` + `ENGINEERING-CONTROL` | defect register | Zero open S0/S1 with agreed severity |

## 3. Матрица независимости прав

| Проверка | Ожидаемый результат |
|---|---|
| Только `crm_project_manager` открывает CRM case | `200`, только assigned scope |
| Только `crm_project_manager` открывает project task | `403` |
| Только `project_executor` открывает свою project task | `200` |
| Только `project_executor` открывает CRM candidate | `403` |
| Только `platform_superadmin` открывает users registry | `200` |
| `platform_superadmin` открывает рабочие CRM read/report экраны | `200`, explicit `all` scope; включая CRM PII с view audit |
| `platform_superadmin` выполняет CRM business write без отдельного write permission | `403`; case transition/reopen, task manage и communication write не наследуются |
| `crm_admin` меняет platform role | `403` |
| Пользователь повышает собственную role | `403` |
| Изменение оставляет менее двух eligible superadmins | `409 SUPERADMIN_QUORUM` |
| `migration_operator` открывает migration run | `200` |
| `migration_operator` сбрасывает пароль | `403` |
| `audit_reader` экспортирует разрешённый audit scope | `200` + export audit event |
| Обычный пользователь открывает audit log | `403` |

## 4. Матрица AI write

| Состояние | Business-domain mutation | Operational/audit persistence | External side effect |
|---|---:|---|---:|
| Ввод/intent/уточнение | 0 | redacted `ai_request` по TTL | 0 |
| Draft/validation/preview | 0 | immutable `ai_draft`, source versions/hash, audit | 0 |
| Cancel/expiry/invalidation | 0 | final draft state + audit | 0 |
| Confirm | ровно одна идемпотентная domain command | result/audit/idempotency | только через outbox command |
| Network retry с тем же key | 0 повторных объектов | исходный result | 0 повторных side effects |
| Batch partial failure | только успешные item commands | per-item outcomes | retry только явно выбранных ошибок |

## 5. Матрица миграционных ворот

| Gate | Pass |
|---|---|
| Source integrity | checksum совпадает, snapshot immutable |
| User classification | 218/218 имеют outcome |
| Employee activation | каждый active login подтверждён авторитетным roster |
| Secrets | target scan = 0 |
| Table disposition | 1 669/1 669 tables classified; included/excluded/quarantine reason present |
| Entity coverage | 438 424/438 424 rows across 57 ledger tables (55 included + 2 quarantine-only) have distinct ledger outcome |
| Relation coverage | 100% проверяемых relations имеют target/outcome |
| Orphans | 0 unexplained |
| Conflicts/rejects | 0 blocking |
| Files | binaries reconciled либо cutover blocked |
| Rehearsal | dry-run и rollback воспроизводимы |
| Approval | signed reconciliation + go/no-go |

## 6. Реестр визуальных доказательств

Существующие 24 референса сохраняются как baseline. Для полного расширенного контура нужны ещё:

- AUTH-01 Вход;
- AUTH-02 MFA;
- AUTH-03 Восстановление пароля;
- ADM-01 Пользователи;
- ADM-02 Роли и effective access;
- ADM-03 Пароль и безопасность;
- ADM-04 Активные сессии;
- ADM-05 Полный журнал аудита;
- MIG-04 Сотрудники и связи.

Итого после дополнения: 33 сценарных референса, не считая трёх отдельных концептов логотипа.
