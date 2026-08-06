# Карта идентичности и миграции Bitrix → кабинет

Статус: проверенный read-only mapping baseline
Дата: 29.07.2026
Source: `sitemanager-final.sql.gz`
SHA-256: `7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`

Документ не содержит ФИО, телефонов, email, password hashes, tokens и иных идентифицирующих значений.

## 1. Главный принцип

`b_user`, сотрудник, учётная запись, кандидат и исторический актор — разные понятия.

```text
legacy user
  ├── employee profile        если доказана связь с оргструктурой
  ├── user account            только после разрешённой активации
  ├── external/system actor   connector, bot, anonymous
  └── legacy actor            авторство и provenance без login

CRM contact
  └── person/program participation

Явная person ↔ user-account связь
  └── только после ручной identity review
```

Совпадение email или телефона не является достаточным основанием объединить сотрудника и кандидата.

## 2. Source integrity

| Проверка | Результат |
|---|---:|
| gzip | valid |
| SHA-256 | matches expected |
| таблиц | 1 669 |
| логических строк | 1 353 224 |
| FK | 0 |
| CHECK constraints | 0 |

Source snapshot должен храниться неизменяемо. Каждая migration run ссылается на checksum и версию transform.

## 3. Пользователи и сотрудники

### 3.1. Фактическая классификация

| Source class | Количество | Target |
|---|---:|---|
| department-linked employees | 20 | `employee_profile` + `legacy_actor`; account по activity rule |
| imconnector | 191 | `external_actor` без login |
| bot | 6 | `system_actor` без login |
| saleanonymous | 1 | `anonymous_actor` без login |
| Итого `b_user` | 218 | 218 ledger outcomes |

Среди 20 сотрудников:

- 14 active;
- 6 inactive;
- 18 входят в legacy-группу «Сотрудники»;
- 2 связаны с подразделениями, но не состоят в этой группе;
- 4 входят в legacy admin group: 3 active и 1 inactive;
- legacy admin group не конвертируется в `platform_superadmin`.

### 3.2. Оргструктура

| Метрика | Количество |
|---|---:|
| подразделений | 5 |
| employee↔department assignments | 29 |
| сотрудников в нескольких подразделениях | 6 |
| conflict с отсутствующим department section | 1 |
| руководителей подразделений | 5 |
| invalid head references | 0 |

Target использует perioded many-to-many
`identity.employee_unit_membership` и отдельный primary unit. Единственный
source conflict попадает в manual queue.

Руководитель — отдельная perioded relation
`identity.organization_unit_head(role=head)`, а не поле unit:
`b_uts_iblock_3_section.VALUE_ID → identity.organization_unit`,
`UF_HEAD → identity.employee_profile`. Обязательны `actor_kind`,
`valid_from/valid_to`, source table/key и provenance. Все пять source links
валидны; inactive/unresolved head блокирует operational scope, не переписывая
исторический actor.

### 3.3. Account lifecycle после миграции

| Source state | Target state |
|---|---|
| active confirmed employee | `credential_state=invited|change_required`, новый credential |
| inactive employee | historical employee; optional disabled account only for referential/UI need, login off |
| connector | external actor |
| bot | system actor |
| anonymous | anonymous actor |
| ambiguous/external | manual review или legacy actor |

Запрещено:

- импортировать `PASSWORD`, hashes, cookies, tokens, app passwords;
- активировать всех `b_user`;
- копировать legacy groups как target roles;
- автоматически выдавать superadmin;
- подменять неизвестного автора текущим администратором.

## 4. Семантика ответственности сотрудника

Прямой identity-link `b_user → b_crm_contact` отсутствует: `UF_USER_CRM_ENTITY` не заполнен.

Связь сотрудника с приезжающим — не identity, а набор независимых назначений:

| Source link | Target relation |
|---|---|
| `b_crm_contact.ASSIGNED_BY_ID` | `crm.crm_profile_assignment(role=owner)` |
| `b_crm_deal.ASSIGNED_BY_ID` | `crm.case_assignment(role=owner)` |
| `b_crm_dynamic_items_1042.ASSIGNED_BY_ID` | `crm.employer_referral_assignment(role=owner)` |
| `b_crm_company.ASSIGNED_BY_ID` | `crm.employer_assignment(role=owner)` |
| `b_tasks.RESPONSIBLE_ID` | `crm.task_assignment` либо `project.task_assignment`, role `responsible`, после task-domain classifier |
| `b_tasks.CREATED_BY` | та же domain relation, role `creator`, historical actor |
| activity/event author/editor/responsible | timeline actor/assignment |

### 4.1. Проверенные owner links

| Source object | Всего | Active employee owner | Inactive employee owner | Missing user |
|---|---:|---:|---:|---:|
| contacts | 3 186 | 2 728 | 458 | 0 |
| deals | 1 899 | 1 829 | 70 | 0 |
| companies | 797 | 709 | 88 | 0 |
| employer directions | 1 808 | 1 808 | 0 | 0 |
| task responsible | 89 | 88 | 1 | 0 |

Владельцев нельзя схлопнуть:

- у 648 из 1 514 сделок с контактом owner сделки отличается от owner контакта;
- только у 987 из 1 801 связанных направлений совпадают owner контакта, дела и направления.

Target хранит каждую relation отдельно и сохраняет период/источник.

### 4.2. Исторические акторы

CRM history использует 26 source actor IDs:

- 13 active employees;
- 6 inactive employees;
- 7 connector/system actors.

Все получают `legacy_actor`. Только подтверждённые сотрудники получают login. Историческое событие продолжает ссылаться на своего source actor.

### 4.3. Возможное совпадение employee/person

Найден один exact email candidate между сотрудником и CRM contact. Он создаёт `identity_review`, но не automatic link/merge.

## 5. Контакты и программные роли

### 5.1. Контакты по типу

| Source type | Количество |
|---|---:|
| участник программы | 2 571 |
| рекомендатель | 557 |
| амбассадор | 30 |
| студент | 9 |
| другое | 18 |
| без типа | 1 |
| Итого | 3 186 |

Target:

- общая `person`;
- типизированная `program_participation`;
- контактные точки отдельно;
- raw source values только в защищённом provenance.

## 6. Сделки и связи с кандидатами

### 6.1. Воронки source

| Source funnel | Deals | С прямым контактом |
|---|---:|---:|
| Переезд | 1 675 | 1 294 |
| Основная legacy-воронка | 222 | 220 |
| Арктический маяк | 1 | 0 |
| Практика | 1 | 0 |
| Итого | 1 899 | 1 514 |

### 6.2. Case↔person

- 1 514 deals имеют contact;
- 98 имеют несколько contacts;
- primary contact согласован между `b_crm_deal.CONTACT_ID` и `b_crm_deal_contact.IS_PRIMARY`;
- 385 deals не имеют прямого candidate;
- для 2 candidate детерминированно восстанавливается через `b_crm_event_relations`;
- 383 не имеют структурного evidence и требуют решения владельца данных;
- contact-deal owner orphan: 0.

Нельзя молча создавать/угадывать candidate. Outcome для 383:

- ручная связь с доказательством;
- legitimate case without person с утверждённым reason;
- исключение с подписанным reason;
- blocking conflict.

### 6.3. Contact-only participants

Контактов без сделки: 1 613:

- 1 002 participants;
- 557 recommenders;
- 30 ambassadors;
- 7 students;
- 16 other;
- 1 without type.

Recommender/ambassador не обязаны иметь case. Для 1 002 participants владелец данных выбирает:

- создать `legacy_contact_only` participation без выдуманной истории;
- создать case только по доказанному правилу;
- manual classification.

Synthetic deal без подтверждённого правила запрещён.

## 7. Работодатели и направления

### 7.1. Companies

| Метрика | Количество |
|---|---:|
| companies | 797 |
| employers | 795 |
| educational organizations | 2 |
| с ИНН | 395 |
| duplicate INN clusters | 20 |
| companies in duplicate INN clusters | 45 |

ИНН нормализуется, но merge выполняется только через conflict queue. Компании без ИНН не объединяются автоматически.

### 7.2. Канонический источник направлений

`b_crm_dynamic_items_1042` — source of truth:

- 1 808 directions;
- 1 801 relations `deal → direction`;
- 507 unique deals;
- max 22 directions per deal;
- `CONTACT_ID` direction всегда пуст;
- candidate определяется через primary contact связанной сделки;
- 1 795 directions имеют candidate + employer.

13 неполных:

- 6 имеют deal/candidate, но нет employer;
- 6 имеют employer, но нет entity relation;
- 1 имеет employer, но relation ведёт к entity type `19`, не deal.

Legacy multi-fields «Работодатель» в contact/deal — только provenance summary:

- contact field: 1 104 valid и 6 invalid company references;
- deal field: 626 valid и 6 invalid;
- пересечение с каноническими directions недостаточно для использования как source of truth.

Множественные значения читаются из `b_utm_*`. `b_uts_*` — PHP-serialized mirror.

### 7.3. Source stages directions

| Stage | Количество |
|---|---:|
| отказ работодателя | 606 |
| запрошена обратная связь | 423 |
| направлен | 335 |
| отказ кандидата | 214 |
| резерв | 89 |
| согласован | 51 |
| собеседование | 48 |
| одобрен | 34 |
| игнор | 8 |

Stage mapping сохраняет source stage/provenance и переводит в утверждённый target vocabulary без потери причины.

## 8. Рекомендатели

Порядок deterministic mapping:

1. explicit recommender contact field;
2. explicit deal recommender;
3. exact referral code → единственный contact type `recommender`;
4. ambiguous/missing → manual.

| Проверка | Результат |
|---|---:|
| recommender contacts | 557 |
| contacts with referral code | 904 |
| unique code links | 320 |
| code without recommender | 24 |
| ambiguous code | 3 |
| valid explicit contact-links | 106 |
| broken explicit contact-links | 1 |
| deals with valid recommender | 173 |
| broken deal links | 3 |
| valid ambassador links | 44 |
| ambassador self-link | 1 manual review |

В 105 сравнимых contact cases и 184 deal cases explicit link согласуется с code mapping. Referral code не является dedupe key.

## 9. Дубликаты

| Signal | Количество |
|---|---:|
| merged phone/email clusters | 219 |
| contacts affected | 571 |
| max cluster size | 20 |
| repeated normalized phones | 201 |
| repeated emails | 199 |
| name + birth-date clusters | 157 |
| contacts in name/date clusters | 424 |
| repeated application numbers | 34 clusters / 71 contacts |

Source не доказывает verified phone/email. Даже exact match сначала идёт в merge queue. Merge сохраняет:

- source IDs;
- compared values/provenance;
- reviewer;
- reason;
- survivor choice per field;
- reversible merge ledger;
- audit event.

## 10. Задачи

| Classification | Количество |
|---|---:|
| only CRM-linked | 39 |
| only project-group | 23 |
| CRM-linked + project-group | 21 |
| neither | 6 |
| Итого | 89 |

Дополнительно:

- 3 CRM user-field links указывают на отсутствующие tasks;
- все 187 task-member user references валидны;
- parent task reference валидна.

Правила:

- 39 → CRM task/activity после проверки subtype;
- 23 → project task;
- 21 → manual classification, потому что source признаки конфликтуют;
- 6 → manual/excluded;
- отсутствующие links → explicit orphan outcome.

Наличие project group не превращает CRM follow-up в project task автоматически.

## 11. Source → target mapping

Точный machine-readable mapping UF identifiers, category/stage codes, enum IDs,
activity/timeline/file bindings: [source-field-map.json](generated/source-field-map.json).

Дополнительные инварианты:

- source enum ID/code сохраняется; mutable label не является target key;
- source typo не исправляется молча, а проходит approved crosswalk;
- consent field 206 переносится только как
  `crm.consent_snapshot`: nullable `legacy_boolean_value`,
  `policy_version=null|unknown`, `captured_at=null`, если source не доказывает
  timestamp, source key/provenance; snapshot не является текущим юридическим
  разрешением и не фабрикует современную consent version/дату;
- stage, legacy status и boolean flags сохраняются раздельно до утверждения precedence;
- `b_utm_*` является source of truth для multiple values.

| Source | Target | Transform |
|---|---|---|
| `b_user` | `identity.legacy_actor` | все 218, immutable source reference |
| `b_user` + `UF_DEPARTMENT` | `identity.employee_profile` + `identity.employee_unit_membership` | 20 department-linked; effective period/provenance |
| active confirmed employee | `identity.user_account` | invite/new credential/MFA policy |
| inactive employee | historical employee; optional disabled account | login off |
| connector/bot/anonymous | external/system/anonymous actor | no login |
| department iblock sections | `identity.organization_unit` | preserve hierarchy |
| `b_utm_user.UF_DEPARTMENT` | `identity.employee_unit_membership` | `VALUE_INT`, many-to-many, perioded |
| groups/memberships | role candidate evidence | do not copy RBAC |
| `b_crm_contact` | `identity.person` + `crm.crm_profile` | source ID/provenance; no automatic employee identity merge |
| `b_crm_field_multi` | `crm.contact_point` | normalize; protect raw |
| `b_uts_crm_contact` + `b_utm_crm_contact` | participation/profiles | explicit custom-field map |
| `b_crm_deal` | `crm.crm_case` | category/stage/version mapping |
| `b_crm_deal_contact` | `crm.case_person` | primary/additional |
| contact/deal/company/direction `ASSIGNED_BY_ID` | `crm.crm_profile_assignment` / `crm.case_assignment` / `crm.employer_assignment` / `crm.employer_referral_assignment` | typed actor kind, role, valid_from/to, source/provenance; never collapse |
| `b_crm_company` + requisite | `crm.employer` | INN conflict queue |
| `b_crm_dynamic_items_1042` | `crm.employer_referral` | canonical direction |
| `b_crm_entity_relation` | referral → case | expected type `2 → 1042` |
| recommender fields/code | `crm.recommender_link` | method/provenance |
| `b_tasks_member.TYPE=A` | `crm.task_assignment` или `project.task_assignment` role `co_executor` после task-domain classifier | 9 rows; не project-only |
| `b_tasks_member.TYPE=O` | `crm.task_assignment` или `project.task_assignment` role `originator` после task-domain classifier | 89 rows |
| `b_tasks_member.TYPE=R` | `crm.task_assignment` or `project.task_assignment` role `responsible` after task classifier | 89 rows |
| tasks/members/CRM UTM | CRM task or project task | explicit classifier/manual; unknown TYPE blocks row |
| `b_crm_deal_stage_history` | `crm.case_stage_history` | 3 932 mapped + 687 blocking conflicts |
| `b_crm_entity_stage_history` | `crm.employer_referral_stage_history` | 3 201 mapped; OWNER_TYPE_ID=1042 |
| both `*_stage_history_with_supposed` | `migration.crm_stage_history_quarantine` | 13 670 quarantine-only; no canonical write |
| `b_crm_observer` | `crm.case_assignment` / `crm.crm_profile_assignment`, role `observer` | 16 deal + 74 contact |
| `b_tasks_log` | `crm.task_history` / `project.task_history` | 399 typed + 230 conflicts |
| `b_tasks_task_dep` | domain task dependency only after classifier/cycle gate | 3 reflexive closure excluded + 1 conflict |
| `b_tasks_stages` / `b_tasks_task_stage` | versioned source stage evidence | no canonical workflow/time inference |
| `b_tasks_result` | `crm.task_result` | 3 protected results |
| disk right/simple-right/sharing/storage | `platform.attachment_acl` / `platform.attachment_storage` | principal, TASK_ID and orphan gates |
| activity/event/timeline | `crm.timeline_event` | keyed-HMAC fingerprint dedupe |
| any source PK | `migration.legacy_reference` | unique system/entity/source ID |

## 12. Migration ledger

Минимальные поля:

- `run_id`;
- `source_table`;
- `source_key` as canonical JSON of real PK/approved unique index;
- `snapshot_sha256`;
- keyed-HMAC fingerprint only where semantic dedupe is required;
- `transform_version`;
- `target_entity`;
- `target_id`;
- `outcome`;
- `reason_code`;
- `attempt`;
- `created_at`;
- `resolved_by`;
- `resolution_audit_event_id`.

Immutable source identity:

`(snapshot_sha256, source_table, canonical_json(source_key), transform_version)`.

Phone/email/content normalization fingerprints используют только
`HMAC-SHA-256`; key хранится во внешнем secret manager, обязательны `purpose`
и `key_version`, разные purpose domain-separated. Unkeyed hash персонального
идентификатора запрещён. Raw input не пишется в ledger, generated artifacts,
stdout, logs, metrics или reconciliation samples. Файловый `SHA-256` является
integrity checksum и не заменяет keyed semantic fingerprint.

Transform attempts/revisions хранят `run_id` и `transform_version` в отдельной versioned history и supersede прежний outcome без создания второй target record. Target write, provenance и актуальный ledger outcome создаются атомарно.

## 13. Reconciliation queries/gates

До cutover:

- `218 = 20 + 191 + 6 + 1`;
- 14 source-active employee profiles имеют кадровое решение; account создаётся только для подтверждённых действующих сотрудников и только с new credentials;
- 6 source-inactive employee profiles сохраняются как historical employees; disabled account создаётся только если он нужен для целостности/интерфейса, login не включается;
- legacy admin → superadmin automatic count = 0;
- 29 department assignments имеют outcome; 1 conflict resolved;
- contact ledger: 3 186/3 186;
- deal ledger: 1 899/1 899;
- company ledger: 797/797;
- direction ledger: 1 808/1 808;
- task ledger: 89/89;
- owner relations reconciled отдельно по каждому entity type;
- current operational-owner queue имеет явное решение для `458` contacts,
  `70` deals, `88` companies, `0` employer referrals и `1` task — ровно
  `617` записей, назначенных неактивным source
  employees; legacy owner остаётся неизменным, новый operational owner
  назначается только вручную/по подписанному versioned rule; каждая запись
  хранит source key, old/new owner, decision/rule version, reviewer, timestamp
  и Ed25519 signature; `MIG-Q-OWNERS-001` возвращает 617 signed outcomes и
  `unresolved=0`, silent fallback запрещён;
- 383 no-candidate deals resolved/excluded with signed reason;
- 1 002 contact-only participants classified;
- 13 incomplete directions resolved;
- 219 duplicate clusters reviewed/queued with outcome;
- 21 dual-use tasks classified;
- 3 missing task links classified;
- 0 unexplained target orphans;
- 0 legacy password/token/secret values in target;
- second identical run creates 0 additional domain records;
- merge/role/superadmin/reassignment decisions exist in audit.

Raw isolated restore неизбежно содержит source password hashes/tokens как часть неизменяемого dump. Он является quarantine source, а не transform staging или target: доступ минимален, значения запрещено выбирать в ETL, логировать или экспортировать. Secret scan `= 0` обязателен для sanitized transform staging, artifacts и target. После приёмки raw restore удаляется по audit purge policy; исходный зашифрованный snapshot хранится по утверждённой retention policy.

## 14. Инструменты ETL

Планируемые команды:

```text
scripts/migration/inspect_bitrix_dump.py
scripts/migration/extract_to_staging.py
scripts/migration/classify_actors.py
scripts/migration/map_custom_fields.py
scripts/migration/build_candidate_associations.py
scripts/migration/build_employer_directions.py
scripts/migration/classify_legacy_tasks.py
scripts/migration/reconcile_run.py
scripts/migration/verify_idempotency.py
```

Каждый инструмент:

- принимает explicit input/output;
- не пишет PII в stdout;
- поддерживает `--dry-run`;
- пишет structured run summary;
- завершается non-zero при blocking invariant;
- не изменяет source;
- имеет repeat/idempotency test.

## 15. Блокеры полного production cutover

Не блокируют разработку и dry-run, но блокируют заявление «production полностью мигрирован»:

- 383 deals без структурного candidate evidence;
- судьба 1 002 contact-only participants;
- 13 incomplete employer directions;
- 219 duplicate clusters;
- 21 dual-use tasks;
- 3 missing task links;
- 1 department conflict;
- authoritative employee roster;
- fresh final snapshot/delta;
- binary `/upload` snapshot;
- общий signed DB/upload freeze watermark и 100% binary/binding/checksum
  reconciliation;
- ACL/storage reconciliation для `284 b_disk_right +
  1 276 b_disk_simple_right + 8 b_disk_sharing + 221 b_disk_storage`;
- versioned owner-approved decode `b_disk_right.TASK_ID` с
  `unknown_task_id_count=0`;
- signed revoke/reissue/exclude decisions для двух `b_disk_external_link`;
  legacy `HASH/PASSWORD/SALT` не импортируются;
- решения `migration_data_owner` для 63 заполненных unmapped CRM UF; семь
  serialized UTS mirrors уже reasoned-excluded в пользу canonical `b_utm_*`;
- 687 unmapped deal-stage history conflicts и signed semantics decisions для
  13 670 supposed-history quarantine rows;
- подписанные правила state/field mapping.

До разрешения запись остаётся видимой в conflict/reject queue; silent fallback запрещён.
