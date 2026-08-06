# Red-team проверка ТЗ

Статус: Round 1, Round 2 и Round 3 исправлены; Gate A `PASS`
Дата: 29.07.2026

## 1. Метод

ТЗ атакуется до реализации с разных позиций:

1. privilege escalation и обход RBAC;
2. identity/password/session/MFA;
3. миграция, дубликаты, orphan и provenance;
4. state machines, concurrency и повтор команд;
5. AI human-in-the-loop и TOCTOU;
6. audit/backup/rollback/интеграции;
7. UX, accessibility и доказуемость приёмки;
8. scope boundary публичного сайта.

Каждая находка получает severity, точную правку и доказательство закрытия. «Учли» без нормативного текста или machine-readable артефакта не считается закрытием.

## 2. Round 1 — атака исходных blueprint/референсов

### 2.1. Роли и безопасность

Атаки:

- администратор назначает себе superadmin;
- CRM-пользователь открывает project API;
- superadmin сбрасывает чужой пароль и входит незаметно;
- отключается последний администратор;
- audit удаляется после изменения роли.

Исправления:

- независимые role domains;
- deny-by-default;
- no self-escalation;
- MFA;
- last/two-superadmin guard;
- reset link вместо просмотра пароля;
- session revoke/notification;
- append-only audit.

### 2.2. Миграция и identity

Атаки:

- все 218 `b_user` получают login;
- employee и candidate объединяются по email;
- inactive/service users активируются;
- historical author подменяется superadmin;
- owner контакта, сделки и направления схлопываются;
- cutover идёт по старому snapshot.

Исправления:

- 218 legacy actors, но только 20 employee candidates;
- canonical person + reviewed account link;
- active roster gate;
- legacy/system actor;
- entity-specific assignment;
- fresh snapshot/delta/reconciliation.

### 2.3. Workflow

Атаки:

- Kanban обходит required fields;
- два менеджера перезаписывают друг друга;
- reopen без причины;
- overdue используется как ручной status;
- CRM/project tasks смешиваются;
- batch сообщает общий успех при частичном результате.

Исправления:

- server state machines;
- optimistic version;
- required reason;
- overdue derived;
- separate task domains;
- per-item batch outcomes.

### 2.4. Эксплуатация

Атаки:

- backup никогда не восстановлен;
- интеграция недоступна;
- migration падает между target и ledger;
- rollback теряет target delta;
- audit содержит PII/заполняет storage.

Исправления:

- restore tests/RPO/RTO;
- outbox/idempotency/fallback;
- atomic target+ledger;
- freeze/watermark/reverse delta;
- redaction/retention/monitoring.

## 3. Round 2 — атака первого цельного ТЗ

### 3.1. P0

| ID | Находка | Исправление | Доказательство |
|---|---|---|---|
| R2-P0-01 | роли без исполнимого permission catalog | permission × operation × object × scope, deny unregistered | `06-authorization-policy-catalog.md`, generated JSON |
| R2-P0-02 | second approval без state/process | immutable hash, proposer≠approver, expiry, one-time execute | `07-state-transition-catalog.md`, generated JSON |
| R2-P0-03 | смешанные account states | четыре независимые оси + transition matrix | ТЗ §6, state catalog |
| R2-P0-04 | слабые sessions/MFA recovery | rotation, TTL, fresh auth, hashed recovery codes, two-control reset | ТЗ §6 |
| R2-P0-05 | audit неатомарен/переписываем | mutation+history+audit+outbox transaction, checkpoint/WORM/verifier | ТЗ §9 |
| R2-P0-06 | AI preview уязвим к TOCTOU | immutable draft hash, actor/object versions, recheck at confirm/item | ТЗ §12 |
| R2-P0-07 | 100% без знаменателя | signed migration scope manifest с counts/rules/queries | generated manifest |
| R2-P0-08 | cutover теряет delta/split-brain | freeze/CDC watermark, final delta before switch, reverse-delta rule | ТЗ §13 |
| R2-P0-09 | две human identity модели | единственная `person`, optional employee/CRM extensions | ТЗ §5 |

### 3.2. P1

| ID | Находка | Исправление |
|---|---|---|
| R2-P1-01 | scopes без оргмодели | memberships/effective dates/row predicates/cache invalidation |
| R2-P1-02 | последний superadmin определён слабо | eligible definition, production minimum two, break-glass |
| R2-P1-03 | неполные state machines | нормативный каталог 13 aggregates |
| R2-P1-04 | disable не решает ownership | impact gate/reassign/unresolved owner |
| R2-P1-05 | ledger не детерминирован | stable source key, revisions, provenance, imported_at |
| R2-P1-06 | metadata может считаться полной файловой миграцией | `/upload` blocking, per-file checksum/scan/outcome |
| R2-P1-07 | нет lifecycle PII staging/AI | raw quarantine vs sanitized staging, purge; masked AI by default |
| R2-P1-08 | intake может дать ложный success | 2xx only after durable persist; JSON 503 otherwise |
| R2-P1-09 | не хватает tracker notifications/support evidence | portal+Max matrix, separate contract delivery evidence |
| R2-P1-10 | acceptance и beginner UX невоспроизводимы | machine crosswalk, keyboard alternatives, measured novice tests |

### 3.3. Scope/DoD

Первый вариант смешивал:

- approved specification;
- approved references;
- working prototype;
- production cutover.

Исправлено четырьмя воротами:

1. Gate A `Spec approved`;
2. Gate B `Reference approved`;
3. Gate C `Prototype accepted`;
4. Gate D `Migration/cutover ready`.

Public site исключён из Prototype DoD. Кабинет предоставляет только provider-side intake API; подключение сайта — отдельный workstream.

## 4. Дополнительная consistency-проверка после Round 2

Уже автоматизировано:

- JSON syntax;
- unique permission codes;
- все transition permissions присутствуют в policy catalog;
- CSV crosswalk имеет обязательные 11 колонок без пустых cells;
- migration manifest table counts совпадают с source inventory;
- snapshot SHA-256 совпадает;
- 24 existing + 9 planned references = 33;
- sensitive dump явно исключён из Git.

Команда:

```bash
node scripts/cabinet/validate-spec-baseline.mjs
```

Текущий результат: `PASSED`.

## 5. Round 3 — финальный независимый consistency-pass

Проверены одновременно:

- `01` ТЗ;
- `02` crosswalk и generated CSV;
- `04` migration identity map;
- `05` screen inventory;
- `06` policy catalog + JSON;
- `07` transition catalog + JSON;
- migration manifest, query registry и target model registry;
- source custom-field/funnel/activity/file map;
- human/machine SHA, duplicate JSON keys и детерминированность генераторов.

Первый независимый прогон выявил `10 P0` и `8 P1`. Находки были возвращены
в нормативные документы, machine-readable каталоги, crosswalk, evidence
registry и валидатор, после чего выполнены повторные атаки.

### 5.1. Закрытые контуры

| Контур | Исправление | Доказательство |
|---|---|---|
| Migration scope | 57 таблиц имеют исполнимый predicate/classifier; `selected + excluded + conflict = baseline`; 115/115 UF-колонок имеют disposition | manifest, query/target registries, baseline validator |
| Identity и связи | типизированные employee/legacy/system relations, период действия, provenance, независимые historical actor и operational assignee | identity map, target registry, migration tests |
| FULL/PARTIAL | FULL не допускает waiver по `/upload`, ACL, checksum, bindings, conflicts или scope | ТЗ, runbook, manifest |
| State machines | 118 transitions согласованы; все 46 permission references зарегистрированы; human/machine каталоги совпадают | state JSON, SHA pin, validator |
| AI human-in-the-loop | operational draft persistence отделён от business mutation; confirm повторно проверяет actor, scope, versions, hash и expiry | ТЗ, policy/state catalogs |
| Role lifecycle | обычные и admin-роли имеют симметричные assign/revoke semantics, reason, audit и negative tests | policy catalog, crosswalk, evidence registry |
| Disable/Archive | typed privileged-role set, точные after-count guards: platform `>=2`, CRM `>=1`, project `>=1`, replacement-first и four-eyes | policy/state catalogs, validator |
| Approval-scoped access | request, actor, payload hash, operation, permission, scope и expiry обязательны; все 9 consuming permissions проверяют binding | policy JSON, validator |

### 5.2. Финальный вердикт

- независимый migration/state/identity pass: `PASS`;
- strict auth/RBAC re-pass: `PASS`, residual `P0 = 0`, `P1 = 0`;
- duplicate-key check policy/state/evidence JSON: `0`;
- общий machine validator: `PASS`;
- UI и публичный сайт в Round 3 не изменялись.

Контрольные значения:

```text
permissions=137
transition_permission_references=46
requirements=57
migration_manifest_tables=57
crm_uf_profiles=115/115
references=24 existing + 9 planned
authorization_sha256=122dcd1e49ed2f8de9edce85b5718e6f144885efe8f40314322760e1386ec0f1
state_sha256=3c36c766b9cc215804ba96fb256b45be8d9d178d953991be3502fd8aff26db5a
```

Gate A открыт: спецификация согласована внутренне и допускает переход к
визуальному Gate B. Это не означает готовность production cutover.

## 6. Внешние prerequisites — не ошибки ТЗ

Даже после Gate A production cutover блокируют:

- authoritative employee roster;
- fresh source snapshot;
- `/upload` binaries;
- решения по 383 deals без candidate evidence;
- судьба 1 002 contact-only participants;
- 13 incomplete employer referrals;
- 219 duplicate clusters;
- 21 dual-use tasks;
- 1 department conflict;
- утверждённые production funnel/formula versions;
- email/Max/AI credentials и privacy policies.

Эти элементы не должны замалчиваться или заменяться автоматическим fallback.
