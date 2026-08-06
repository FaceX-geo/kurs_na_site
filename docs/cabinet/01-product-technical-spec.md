# Продуктово-техническое задание внутреннего кабинета

Версия: 1.0, baseline после первичного аудита
Дата: 29.07.2026
Объект: CRM + проектный трекер + ИИ + суперадмин + миграция
Публичный сайт: отдельный workstream, не изменяется этим ТЗ

## 1. Назначение документа

Документ является реализационной спецификацией внутреннего кабинета и объединяет:

- прямые требования договора;
- явные расширения пользователя;
- обязательные инженерные контроли;
- критерии миграции и приёмки;
- границу между человеком и автоматизацией.

Если демонстрационный текст референса расходится с этим ТЗ, приоритет имеют:

1. безопасность и сохранность данных;
2. подписанный договор;
3. явное уточнение пользователя;
4. это ТЗ;
5. визуальный референс.

Визуальная форма должна максимально точно повторять утверждённые референсы, но не может отменять проверку прав, подтверждение опасной операции или журналирование.

## 2. Цель и пользовательский результат

### 2.1. Бизнес-цель

Перенести работу команды из Bitrix в понятную внутреннюю систему, которая:

- ведёт кандидата или студента от заявки до результата;
- сохраняет ответственных, авторство, коммуникации и историю;
- даёт команде самостоятельный проектный трекер;
- снимает ручную сборку отчётов и заполнение задач;
- позволяет управлять доступами без помощи разработчика;
- делает миграцию, ошибки и действия системы наблюдаемыми;
- оставляет человеку контроль над смысловыми и рискованными решениями.

### 2.2. Результат для сотрудника

Сотрудник после входа видит только разрешённые ему данные и может:

- понять, что требует внимания сегодня;
- открыть свою воронку, кандидата, работодателя или задачу;
- выполнить следующий шаг без поиска контекста по разным системам;
- попросить ИИ сделать сводку, отчёт или черновик задачи обычной фразой;
- проверить черновик и только затем сохранить действие.

### 2.3. Результат для руководителя

Руководитель получает:

- проверяемые показатели с drill-down до исходных записей;
- нагрузку, просрочки, риски и план-факт;
- раздельные агрегаты CRM и проектного трекера;
- историю действий и причин критических изменений.

### 2.4. Результат для администратора

Уполномоченный администратор может:

- создавать и приглашать пользователей;
- назначать независимые роли CRM, tracker и platform;
- блокировать доступ и отзывать сессии;
- инициировать безопасный сброс пароля;
- видеть эффективные права до сохранения;
- расследовать событие по append-only audit log;
- контролировать импорт, конфликты и reconciliation.

## 3. Классификация объёма

### 3.1. `CONTRACT`

- две CRM-воронки «Переезд» и «Студенты»;
- список/канбан, карточка 360° и таймлайн;
- анкета, UTM/source и проверка дублей;
- «Арктический маяк»;
- работодатели и направления;
- трудоустройство и параметры переезда;
- CRM-задачи, email и Max;
- персональный дашборд, уведомления и отчёты;
- импорт Bitrix с дедупликацией, валидацией, историей и ручной конфликтной очередью;
- иерархия направление → проект → подпроект → задача → подзадача;
- список, канбан, Gantt, нагрузка и план-факт;
- договорные роли двух независимых контуров;
- текстовый ИИ в CRM и tracker;
- техническая документация, обучение и поддержка.

### 3.2. `USER-EXPANSION`

- ИИ-отчёты обычным языком;
- создание одной или нескольких задач через ИИ;
- UX для пользователя без опыта работы с CRM/трекерами;
- платформенный суперадмин;
- реестр и карточка пользователей;
- управление ролями и областями;
- безопасный reset/change password;
- управление сессиями;
- системный журнал действий;
- перенос сотрудников и их типизированных связей с кандидатами;
- текстовый логотип «Курс на Север» со знаком «Роза Севера».

### 3.3. `ENGINEERING-CONTROL`

- deny-by-default и серверная проверка каждого действия;
- MFA для привилегированных ролей;
- защита последнего суперадмина;
- запрет self-escalation;
- second approval для назначения платформенного суперадмина;
- append-only audit;
- optimistic locking;
- идемпотентность write/import/integration команд;
- transactional outbox;
- migration ledger;
- secret scan;
- резервное копирование и проверка восстановления;
- мониторинг, request/trace IDs и redaction PII;
- visual regression, accessibility и негативные E2E.

### 3.4. `OUT-OF-SCOPE`

- изменение или повторная разработка публичного сайта;
- CMS публичного сайта;
- бухгалтерия и финансовые проводки;
- бюджетирование, казначейство и платёжный календарь;
- закупки и склад;
- начисление зарплаты и кадровый учёт;
- автономные AI-решения о допуске кандидата;
- автоматическое слияние неоднозначных дублей;
- личные кабинеты кандидата, работодателя или рекомендателя;
- перенос legacy passwords/tokens/cookies;
- production cutover без свежего snapshot и go/no-go.

## 4. Архитектурное решение

### 4.1. Стиль

На первом этапе используется модульный монолит, а не набор микросервисов. Это уменьшает операционный шум, но сохраняет явные доменные границы.

Состав:

```text
public-site                 отдельный существующий workstream
    |
    | POST /public/v1/applications
    v
intake-edge ──> durable intake store/outbox ──> core-api
    ├── identity
    ├── access-control
    ├── audit
    ├── crm
    ├── project-tracker
    ├── reports
    ├── ai-command-gateway
    ├── migration
    └── integrations/outbox
        |
        ├── PostgreSQL
        ├── object storage
        ├── worker
        ├── corporate email
        ├── Max
        └── approved AI provider

cabinet-web ───────────────> core-api
```

Модули не обращаются к приватным таблицам друг друга напрямую. Сквозные операции используют application service и типизированные события.

### 4.2. Нормативный стек Gate C/D

| Слой | Решение |
|---|---|
| Web | React + TypeScript + Vite |
| Routing/state | React Router, TanStack Query |
| Таблицы | TanStack Table с собственным визуальным слоем |
| Формы/валидация | React Hook Form + Zod |
| Графики | Recharts только для содержательных показателей |
| API | Node.js LTS + TypeScript + Fastify |
| Контракт | OpenAPI 3.1 + JSON Schema |
| БД | PostgreSQL 16+ |
| SQL/migrations | явные версионированные SQL migrations; typed query layer |
| Очереди | transactional outbox + worker; внешняя очередь добавляется при измеренной необходимости |
| Файлы | S3-compatible object storage |
| Auth | server-side sessions, Argon2id, TOTP MFA |
| Тесты | Vitest, API integration tests, Playwright E2E после разрешения пользователя на выбранный браузер |
| Наблюдаемость | structured logs, OpenTelemetry-compatible traces/metrics |

PostgreSQL 16+ и единая цепочка версионированных SQL migrations обязательны
для Gate C и Gate D: на них проверяются persisted prototype data, atomic
domain/history/audit/outbox writes, RBAC, migration rehearsal и restore.
SQLite/in-memory разрешены только для изолированного `UI preview` и никогда не
получают статус `Prototype accepted`.

Выбор не требует разбиения на микросервисы и поддерживается одной продуктовой командой. Доменные пакеты должны быть извлекаемыми, если нагрузка или независимый release cadence этого потребуют.

### 4.3. Развёртывание

- исходный публичный nginx остаётся отдельным сервисом;
- `cabinet-web`, `intake-edge`, durable intake store/outbox, `core-api`,
  `worker`, PostgreSQL и object storage разворачиваются отдельным
  compose/project-контуром;
- любые Docker Engine/Compose операции этого репозитория выполняются только через Bravo remote context;
- development secrets не хранятся в Git;
- `/api/*` никогда не попадает в HTML SPA fallback;
- health проверяет процесс, readiness — БД/migrations/outbox, intake durable
  store, object storage и обязательные signing/checkpoint dependencies;
- production требует TLS, отдельный secret store и резервную площадку хранения backup.

## 5. Доменная модель

### 5.1. Identity и сотрудники

| Сущность | Назначение |
|---|---|
| `person` | единственная canonical human identity без права входа по умолчанию |
| `user_account` | только credentials, account/credential/risk/MFA states |
| `employee_profile` | optional extension сотрудника по `person_id` |
| `crm_profile` | optional extension кандидата/студента/рекомендателя по `person_id` |
| `person_account_link` | проверенная связь person ↔ account со status/evidence/reviewer/reviewed_at |
| `role` | стабильный код роли |
| `permission` | атомарное разрешение |
| `user_role_assignment` | роль пользователя с domain и scope |
| `authorization_policy_catalog` | permission × command/query × object predicate × scope |
| `approval_request` | неизменяемая заявка four-eyes на critical operation |
| `session` | активная/отозванная server-side сессия |
| `password_reset_token` | одноразовый хэшированный reset token |

Совпадение email/телефона никогда автоматически не объединяет employee и candidate и не создаёт `person_account_link`. Ownership/author/responsible указывают на `employee_profile`, `user_account` или `legacy_actor` и не являются identity link кандидата. Историческое авторство и текущая ответственность хранятся раздельно.

### 5.2. CRM

| Сущность | Назначение |
|---|---|
| `crm_profile` | CRM-расширение canonical `person` |
| `program_participation` | участие человека в программе с типом relocation/student/recommender |
| `crm_case` | дело в конкретной воронке |
| `case_assignment` | owner, curator, observer с периодом действия |
| `case_stage_history` | история переходов, причина и версия |
| `candidate_source` | source, UTM, форма и consent version |
| `recommender_link` | код и двусторонняя связь |
| `document_check` | тип, status, reason, reviewer |
| `employer` | организация с нормализованным ИНН |
| `employer_contact` | несколько контактов организации |
| `employer_referral` | направление кандидата работодателю и результат |
| `relocation_profile` | трудоустройство, место/дата переезда, состав |
| `crm_task` | задача CRM, отдельная от project task |
| `crm_activity` | письмо, Max, звонок, комментарий, статус, task event |
| `duplicate_candidate` | пара/кластер совпадений и решение reviewer |

### 5.3. Project tracker

| Сущность | Назначение |
|---|---|
| `direction` | верхний уровень портфеля |
| `project` | проект или подпроект с parent |
| `project_member` | участник и роль в проекте |
| `project_task` | задача проекта, не CRM task |
| `project_task_assignee` | один accountable responsible |
| `project_task_executor` | дополнительные исполнители |
| `project_task_dependency` | зависимость без циклов |
| `project_task_history` | изменения полей/status/сроков |
| `project_comment` | комментарий и упоминания |
| `attachment` | метаданные и object storage reference |
| `work_calendar` | рабочие дни для сроков и просрочек |

### 5.4. Платформа

| Сущность | Назначение |
|---|---|
| `audit_event` | append-only событие |
| `outbox_event` | идемпотентная внешняя доставка |
| `notification` | пользовательское уведомление |
| `report_definition` | версия формулы и доступных dimensions |
| `report_run` | параметры, freshness, result metadata |
| `ai_request` | безопасный audit запроса без скрытых chain-of-thought |
| `ai_draft` | структурированный черновик |
| `ai_command` | подтверждённая команда с idempotency key |
| `migration_run` | партия импорта |
| `migration_ledger` | source record → target record/outcome |
| `migration_conflict` | ручной конфликт и решение |
| `legacy_actor` | исторический actor без активного login |
| `migration_scope_manifest` | подписанный знаменатель coverage для snapshot |

## 6. Аутентификация, пароли и сессии

### 6.1. Вход

- login по нормализованному email или утверждённому username;
- пароль хранится только как Argon2id hash;
- cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, random opaque token;
- в БД хранится только hash session token;
- CSRF-защита для browser write requests проверяет token и trusted `Origin`/`Referer`;
- rate limit и progressive delay;
- одинаковый внешний ответ для неизвестного пользователя и неверного пароля;
- privileged roles требуют MFA.

### 6.2. Password lifecycle

Состояния независимы:

| Ось | Значения |
|---|---|
| `account_state` | `active`, `disabled`, `archived` |
| `credential_state` | `invited`, `password_set`, `change_required`, `expired` |
| `risk_state` | `normal`, `locked` |
| `mfa_state` | `not_enrolled`, `enrollment_required`, `enrolled`, `recovery_required` |

Для каждой разрешённой комбинации действует versioned transition matrix: actor, guard, fresh re-auth/approval, session effect, notification и audit. `disabled`, `archived` и `locked` проверяются на каждом authenticated request, а не только при login.

Правила:

- legacy hash не импортируется;
- суперадмин не видит существующий пароль;
- основной путь создания пользователя — одноразовая invite/reset link; постоянный или отображаемый администратору временный пароль через UI запрещён;
- reset token одноразовый, ограничен по времени и хранится хэшированным;
- административный reset отзывает все сессии и все ранее выданные invite/reset tokens;
- обычная смена пароля ротирует текущую сессию и отзывает остальные;
- пользователь получает уведомление о сбросе;
- причина административного reset обязательна;
- secret не попадает в audit/log/analytics.

### 6.3. Сессии

Пользователь видит свои активные сессии и может отозвать любую кроме текущей или все сразу. Суперадмин может отозвать сессии пользователя с причиной. Disabled/locked account не может продолжать старую сессию.

Дополнительные инварианты:

- session ID ротируется после login, MFA, password change и privilege change;
- бессрочные сессии запрещены; обычные и privileged sessions имеют отдельные idle и absolute TTL;
- password, MFA, role/scope, export и integration-secret операции требуют fresh password + MFA re-auth;
- TOTP secret хранится зашифрованным;
- recovery codes показываются один раз и хранятся только как hashes;
- privileged MFA reset требует second approval, отзывает все сессии и уведомляет пользователя;
- защита от session fixation проверяется integration test;
- завершение текущей сессии немедленно возвращает на login;
- session expiry не применяет несохранённый draft и позволяет восстановить его после повторного входа без secret fields.

## 7. RBAC и области доступа

### 7.1. Домены ролей

Роли разделены:

- `platform`;
- `crm`;
- `project`;
- `migration`;
- `audit`.

Наличие platform-роли не открывает бизнес-данные CRM/tracker автоматически.

### 7.2. Стабильные роли

| Код | Назначение |
|---|---|
| `platform_superadmin` | lifecycle accounts, platform roles, sessions, system settings |
| `crm_project_manager` | свои/назначенные CRM cases и CRM tasks |
| `crm_lead_specialist` | команда/подразделение, рабочие reports |
| `crm_admin` | funnels, fields, CRM permissions/integrations |
| `crm_department_head` | dashboards/reports/export в своём scope |
| `project_admin` | полный project domain |
| `project_direction_lead` | своё направление |
| `project_manager` | свои проекты |
| `project_executor` | назначенные project tasks |
| `migration_operator` | runs/conflicts/reconciliation без управления accounts |
| `audit_reader` | read/export разрешённых audit events |

`crm_project_manager` и `project_manager` — разные коды и разные permissions.

### 7.3. Scopes

- `self`;
- `assigned`;
- `team`;
- `department`;
- `direction`;
- `project`;
- `all`.

API вычисляет effective access из role + scope + entity membership. UI скрывает недоступное, но не является контролем безопасности.

`team`, `department`, `direction` и `project` основаны на versioned `organization_unit`, `membership` и `project_membership` с effective dates. Для каждого scope определён точный row predicate. Изменение membership инвалидирует authorization cache; audit сохраняет policy version и scope snapshot, использованные при решении.

### 7.4. Исполнимый каталог разрешений

До реализации API создаётся версионированный `authorization_policy_catalog`. Для каждого query/command фиксируются:

- permission code;
- domain;
- object type;
- row/object predicate;
- допустимые scopes;
- `view`, `export` и `manage` как разные права;
- владелец права назначения;
- обязательные отрицательные правила;
- policy version.

Наличие route/query/command без строки каталога означает deny. CI сравнивает OpenAPI/command registry с каталогом и блокирует неизвестный endpoint.

Любое расширение effective permissions или scopes требует `actor_id != subject_id`. Пользователь, включая `platform_superadmin`, не может выдать себе CRM, project, migration, audit или platform access. Роль назначается только actor, явно уполномоченным владельцем соответствующего домена. Изменение вступает в силу после серверного пересчёта effective access, rotation/revocation затронутых privileged sessions и записи audit event.

Lifecycle обычных ролей симметричен и не допускает неявного исчезновения роли при
замене набора: `AssignCrmRole`/`RevokeCrmRole`,
`AssignProjectRole`/`RevokeProjectRole`,
`AssignMigrationRole`/`RevokeMigrationRole` и
`AssignAuditRole`/`RevokeAuditRole`. Каждая mutation требует reason,
effective-access preview, `expected_version`, before/after audit с policy version
и пересчёт либо отзыв затронутых privileged sessions. Назначение и отзыв
`migration_operator`/`audit_reader` являются critical; активные migration runs,
audit scopes, operational responsibility и незавершённые approvals должны быть
переданы до выполнения.

Первый `crm_admin`/`project_admin` назначается одноразовой bootstrap-командой
после platform ceremony. Следующие domain admins назначаются отдельной critical
командой с подтверждением действующего eligible admin целевого домена. Отзыв
`platform_superadmin`, `crm_admin` или `project_admin` разрешён только после
назначения преемника, с four-eyes, запретом self-revoke и проверкой, что после
операции остаются минимум два eligible platform superadmin и минимум один
eligible admin каждого домена. Обычная role-команда не может назначить или
отозвать domain-admin role в обход этого lifecycle. `DisableUser`/`ArchiveUser`
считают subject привилегированным, если у него есть постоянная роль
`platform_superadmin`, `crm_admin`, `project_admin`, `migration_operator`,
`audit_reader` либо действующий approval-scoped subject
`explicit_ai_pii_role`, `designated_release_owner`,
`designated_platform_ops`. Для такого subject обязательны four-eyes и
replacement-first. Если subject имел соответствующую admin role, after-count
должен быть ≥2 eligible `platform_superadmin`, ≥1 eligible `crm_admin` и ≥1
eligible `project_admin`. Для migration/audit minimum не вводится, но critical
approval, отсутствие orphan approvals и явная передача operational ownership
обязательны.

### 7.5. Four-eyes critical approval

Критическая операция создаёт immutable `approval_request` с hash:

`{subject, operation, role, scope, reason, proposer, payload_version, expires_at}`.

Состояния:

- `pending`;
- `approved`;
- `rejected`;
- `expired`;
- `executed`;
- `cancelled`.

Правила:

- proposer и approver — разные активные eligible пользователи;
- self-approve запрещён;
- изменение payload инвалидирует прежнее approval;
- permission повторно проверяется при approve и execute;
- execute одноразовый и идемпотентный;
- expiry обязательна;
- отказ/истечение/отмена также аудируются.

`explicit_ai_pii_role`, `designated_release_owner` и
`designated_platform_ops` — не постоянные UI-роли, а auto-expiring
approval-scoped subjects. Их контекст обязан содержать
`approved_request_id`, `actor_id`, `payload_hash`, `approved_operation`,
`approved_permission`, точный dataset/migration/operation scope и
`expires_at`. Каждое permission, которое допускает такой subject, на каждом
использовании повторно связывает request, actor, payload hash, operation,
permission, scope и expiry; несовпадение означает deny. Для permission с
одновременно постоянными и approval-scoped principals этот guard применяется
при выборе approval-scoped grant path.

Four-eyes применяется к:

- назначению/снятию `platform_superadmin`;
- privileged MFA reset;
- break-glass recovery;
- изменению audit permissions;
- изменению integration permissions/secrets;
- другим permission codes, помеченным `critical`.

### 7.6. Инварианты

- deny-by-default;
- прямой URL/API возвращает `403`, а не скрытый успех;
- нельзя повысить собственные роли/scopes в любом domain;
- назначение `platform_superadmin` проходит formal second approval;
- `eligible_superadmin` означает: active + unlocked + valid credential + enrolled MFA;
- в production должно быть не менее двух eligible superadmins;
- bootstrap одного разрешён только в явно помеченном non-production prototype
  и никогда не является переходным production-состоянием;
- нельзя отключить, архивировать, заблокировать или лишить роли последнего/предпоследнего eligible superadmin так, чтобы осталось меньше двух;
- role changes требуют reason;
- до сохранения показывается effective-access preview;
- пользователь с acceptance-набором ролей проверяет все экраны, но platform-role сама по себе не раскрывает PII.

Offline break-glass protocol использует two-person control, time-bound access, отдельную ротацию secret, уведомление и подписанный audit checkpoint. Он не реализуется как скрытый постоянный root account.

## 8. Суперадмин

### 8.1. Реестр пользователей

Поля и фильтры:

- display name;
- email/login;
- account status;
- employee status;
- department/position;
- CRM roles/scopes;
- project roles/scopes;
- platform/migration/audit roles;
- MFA status;
- last login;
- active sessions;
- legacy source/outcome;
- created/updated dates.

Действия:

- создать/пригласить;
- открыть карточку;
- активировать/заблокировать/деактивировать;
- инициировать reset;
- отозвать сессии;
- явно назначить или отозвать роль/scope с effective-access preview, reason и before/after audit;
- открыть историю;
- экспортировать безопасный список в пределах прав.

### 8.2. Карточка пользователя

Вкладки:

- профиль;
- учётная запись;
- роли и эффективный доступ;
- сессии;
- история;
- legacy links.

Каждое write action использует optimistic lock и reason. Sensitive change показывает diff и требует повторного подтверждения.

Перед disable/archive сотрудника выполняется impact gate. Preview показывает:

- активные CRM cases и CRM tasks;
- project tasks и accountable responsibilities;
- pending approvals;
- owned reports/integration schedules;
- число активных сессий.

Текущая работа должна быть переassign либо явно помещена в `unresolved_owner` queue. Historical actor и прежнее авторство не меняются. Disabled employee не может получать новые назначения; все его sessions/tokens отзываются атомарно с account transition.

### 8.3. Bootstrap

Bootstrap — отдельная one-time state до начала production, чтобы second approval не зависел от ещё не существующего второго администратора.

Production ceremony:

- trusted CLI принимает двух разных предварительно подтверждённых людей;
- создаёт две раздельные one-time invite links, но не пароль;
- каждый самостоятельно задаёт credential и enroll MFA;
- bootstrap завершается только после появления двух eligible superadmins;
- bootstrap manifest содержит identities, ceremony operator, owner approval, timestamps и audit/WORM checkpoint;
- self-approval через первый аккаунт не используется;
- после завершения bootstrap endpoint/CLI необратимо закрывается;
- повтор возможен только через break-glass recovery protocol.

Prototype допускает один acceptance superadmin только с флагом `non_production_bootstrap`. Пока нет второго eligible superadmin, запрещены production cutover, выдача новых critical roles, privileged MFA reset и изменение audit/integration permissions.

## 9. Append-only audit

### 9.1. Обязательные события

- login success/failure/lockout;
- MFA enroll/reset;
- invite/password reset/password change;
- session revoke;
- user create/status change;
- role/scope change;
- PII view/export;
- candidate merge/unmerge;
- funnel critical transition/reopen/close;
- employer merge;
- message send/retry/failure;
- AI request/draft/confirm/execute;
- migration run/conflict decision/cutover/rollback;
- integration secret/config change без значения секрета.

### 9.2. Поля события

- immutable event ID;
- UTC timestamp;
- actor type/id;
- effective roles;
- action;
- target type/id;
- result;
- reason;
- redacted before/after;
- tenant/scope;
- IP;
- session ID;
- request/trace ID;
- source;
- integrity/hash-chain metadata.

### 9.3. Защита

- domain mutation, domain history, mandatory audit event и outbox event фиксируются одной DB transaction;
- если обязательный audit event не записан, mutation откатывается;
- privileged writes работают fail-closed при недоступности audit subsystem;
- приложение не имеет `UPDATE/DELETE` на audit store;
- UI не содержит edit/delete;
- секреты, full password/reset token и raw AI credentials не сохраняются;
- audit payload строится только из versioned allowlist конкретного event type;
- forbidden fields удаляются до storage и до расчёта hash-chain;
- IP маскируется или псевдонимизируется по утверждённой policy; session token,
  password/hash, invite/reset token и integration secret не сохраняются никогда;
- экспорт тоже создаёт audit event;
- hash-chain периодически завершается подписанным checkpoint;
- signing key хранится вне БД, checkpoint копируется во второе append-only/WORM storage;
- независимый verifier проверяет gaps, chain и checkpoints и поднимает alert;
- versioned retention table задаёт срок по event class, legal hold, правила
  masking/export, archive и purge; purge создаёт audit event и checkpoint;
- удалённый по policy архив никогда не выдаётся интерфейсом за полную цепочку;
- privileged audit access не означает доступ к полному business object.

## 10. CRM

### 10.1. Воронки

Две независимые funnel definitions:

- `relocation`;
- `student`.

Baseline стадии для работающего прототипа являются настраиваемой версией процесса и должны быть подтверждены владельцем процесса перед production.

Relocation:

1. `new` — новая заявка;
2. `qualification` — квалификация;
3. `documents` — документы/рекомендатель;
4. `employer_selection` — подбор работодателя;
5. `employer_review` — на рассмотрении;
6. `offer` — предложение/согласование;
7. `relocation_preparation` — подготовка переезда;
8. `moved` — переехал;
9. `closed_unsuccessful` — завершено без результата.

Student:

1. `new`;
2. `qualification`;
3. `practice_selection`;
4. `host_review`;
5. `placement_confirmed`;
6. `in_practice`;
7. `completed`;
8. `closed_unsuccessful`.

Для каждого transition настраиваются:

- from/to;
- role;
- required fields;
- reason required;
- side effects;
- notifications;
- reopen rule;
- SLA;
- version.

Drag-and-drop вызывает тот же server command, что и форма. Обойти required fields через kanban нельзя.

### 10.2. Optimistic concurrency

Каждый case имеет `version`. При одновременном изменении второй пользователь получает conflict view:

- кто и когда изменил;
- исходные и новые значения;
- возможность перечитать;
- возможность повторить своё изменение поверх актуальной версии после проверки.

### 10.3. Карточка 360°

Layout:

- слева/в основной области — сводка, stage, manager, source, masked contacts, next step;
- справа — хронологический timeline;
- вкладки: «Основная информация», «Арктический маяк», «Работодатели», «Переезд».

Timeline объединяет только отображение. Исходные события остаются типизированными и не теряют автора/результат доставки.

### 10.4. Дедупликация

Нормализуются:

- телефон;
- email;
- ФИО + дата рождения;
- ИНН работодателя.

Exact match может заблокировать создание скрытого дубля, но не выполняет merge без reviewer. Fuzzy match всегда попадает в очередь. Сравнение показывает:

- provenance каждого значения;
- exact/conflicting values;
- survivorship choice;
- обязательную причину;
- reviewer;
- reversible merge ledger.

### 10.5. «Арктический маяк»

- recommender code уникален в утверждённой области;
- связь двусторонняя;
- status документа берётся из справочника;
- отказ/несоответствие требует reason;
- critical status change попадает в timeline/audit.

### 10.6. Работодатели

- ИНН нормализуется и проверяется на дубль;
- филиал и ИП имеют явные правила типа организации;
- несколько contact persons хранятся строками;
- направление имеет candidate, employer, responsible, date, status, comment;
- статусы: «На рассмотрении», «Принят», «Отказ»;
- изменение результата сохраняет историю;
- компания без ИНН создаётся только в manual-review режиме.

### 10.7. Переезд

Сохраняются:

- employer/job title;
- offer/employment status;
- municipality;
- locality;
- planned/actual relocation date;
- household composition;
- support measures;
- result/reason;
- data provenance.

Критические поля completion стадии `moved` проверяются сервером.

### 10.8. CRM-задачи

CRM task содержит:

- title/description;
- one responsible;
- optional participants;
- due date/timezone;
- priority;
- status;
- linked CRM object;
- checklist;
- attachments;
- comments;
- history.

`overdue` — вычисляемый признак, не ручной status.

### 10.9. Коммуникации

- email и Max пишутся через outbox;
- каждое сообщение имеет idempotency key;
- retry не создаёт дубль;
- delivery state: queued/sent/delivered/failed;
- массовая отправка всегда имеет preview, выборку и отдельное подтверждение;
- частичный batch показывает успех/skip/error для каждого элемента;
- недоступность интеграции не блокирует ручную работу в CRM.

### 10.10. Отчёты

Группы:

- воронки;
- кандидаты/студенты;
- работодатели/направления;
- CRM tasks;
- переезды;
- коммуникации/рассылки;
- менеджеры/команда.

Каждый report показывает:

- период и timezone;
- scope;
- filters;
- formula version;
- data freshness;
- excluded records;
- KPI/table/chart;
- drill-down;
- export permissions.

## 11. Project tracker

### 11.1. Иерархия

`Direction → Project → Subproject → Task → Subtask`.

Правила:

- цикл parent/dependency запрещён;
- удаление непустого проекта запрещено;
- вместо destructive delete используется archive;
- перенос между проектами сохраняет history;
- доступ пересчитывается до применения и показывается пользователю.

### 11.2. Project task

Поля:

- title/description;
- project/subproject;
- accountable responsible;
- executors;
- planned start/end;
- actual completion;
- priority;
- status;
- dependencies;
- checklist/subtasks;
- files/comments/history.

Статусы договора:

- `to_do` — «К работе»;
- `in_progress` — «В работе»;
- `review` — «На проверке»;
- `done` — «Выполнена».

«Просрочена» отображается как вычисляемый contract badge `is_overdue`, потому что задача одновременно сохраняет рабочий status. Это исключает противоречие «В работе» и «Просрочена».

Приоритеты:

- низкий;
- средний;
- высокий.

### 11.3. Представления

Список, Kanban и Gantt обязаны показывать один и тот же набор при одинаковом scope/filters. Нагрузка и план-факт используют версионированные формулы. На Gantt видны planned/actual bars, dependencies, today marker и blocked chain.

### 11.4. Нормативный каталог переходов

Versioned transition tables обязательны не только для воронок, но и для:

- relocation funnel;
- student funnel;
- CRM task;
- document check;
- employer referral;
- project task;
- user account по четырём независимым state axes;
- migration run/conflict;
- AI draft/batch job;
- message delivery.

Каждая строка transition table содержит:

- aggregate/from/to;
- permission;
- required fields;
- required reason;
- expected version;
- guard;
- side effects;
- audit/outbox events;
- reopen/undo rule.

Aggregate update, history, audit и outbox выполняются одной transaction. Version mismatch возвращает `409 VERSION_CONFLICT`; silent last-write-wins запрещён.

### 11.5. Уведомления tracker

Матрица событий portal + Max включает:

- назначение responsible/executor;
- status change;
- приближение due date;
- overdue;
- comment;
- mention;
- dependency/blocked change.

Для каждого события определены получатель, permission-safe payload, deep link, channel preference, quiet hours, idempotency key, retry и escalation. Уведомление никогда не раскрывает название/PII объекта пользователю без права открыть deep link.

## 12. ИИ-помощник

### 12.1. Принцип

Пользователь говорит обычным языком. Система переводит запрос в проверяемый результат и не скрывает область действия.

В интерфейсе не используются термины `prompt`, `agent`, `tool call`, `temperature`, `RAG`.

Первичные действия:

- «Создать задачу»;
- «Сделать отчёт»;
- «Подвести итог»;
- «Найти проблемы»;
- «Что требует внимания».

### 12.2. Контекст

Всегда виден scope:

- эта сделка;
- этот кандидат;
- этот проект;
- мои задачи;
- моё подразделение;
- вся доступная CRM.

ИИ не расширяет scope и не получает service-account права сверх пользователя.

### 12.3. Архитектура команд

```text
request
  → classify intent
  → resolve allowed context
  → structured draft
  → deterministic validation
  → human-readable preview
  → explicit confirm
  → idempotent domain command
  → audit + result link
```

Модель:

- не получает raw database credentials;
- не выполняет произвольный SQL;
- вызывает allowlisted read tools и draft builders;
- write выполняет только обычный domain command после подтверждения;
- не раскрывает скрытые системные инструкции;
- входные документы считаются недоверенными и не могут менять policy.

До confirm допускается только операционное сохранение минимизированных
`ai_request`, immutable `ai_draft` и audit rows по TTL. В этот момент:

- business-domain mutation = `0`;
- outbox/external side effect = `0`;
- actor/scope/source versions/draft hash сохраняются для проверки;
- prompts/responses редактируются до хранения.

После confirm выполняется ровно одна идемпотентная allowlisted domain command.
Operational persistence не считается скрытым business write и не может
использоваться как обход подтверждения.

### 12.4. Создание задачи

Preview содержит:

- CRM или project contour;
- linked object;
- title/description;
- responsible/executors;
- due date/timezone;
- priority/status;
- notifications;
- число объектов для batch;
- warnings/conflicts;
- ожидаемый audit event.

Неоднозначный ответственный или срок требует одного короткого уточнения. Повтор после network error использует тот же idempotency key.

`ai_draft` неизменяем и содержит:

- hash всех будущих изменений;
- actor ID и session assurance;
- domain/scope;
- source object IDs и versions;
- exact batch selection/fingerprint;
- policy/rules/model version;
- created/expiry time;
- idempotency key.

Draft одноразовый. При confirm сервер заново проверяет actor/session/MFA, RBAC, memberships, object versions, required fields и selection; для batch — перед каждым item. Изменение данных, прав, scope или payload инвалидирует preview и требует нового подтверждения. Созданный объект получает `created_by=<human>` и `creation_origin=ai`; AI model никогда не становится actor.

### 12.5. ИИ-отчёт

До построения показываются:

- dataset;
- period;
- scope;
- dimensions;
- metrics/formula version;
- PII inclusion;
- output format.

Результат должен совпадать с deterministic report engine. ИИ объясняет и суммирует уже рассчитанные данные, но не изобретает числа.

### 12.6. Массовые операции

- отдельное подтверждение;
- выборка и число объектов;
- несколько примеров;
- полный downloadable preview в пределах export permission;
- per-item result;
- retry только ошибок;
- возможность остановить ещё не начатые элементы.

Частичный batch не отображается общим успехом: результат каждого item имеет `created|skipped|conflict|forbidden|failed`. Confirm hash и selection fingerprint не позволяют незаметно расширить выборку между preview и execute.

### 12.7. Fallback

При недоступности AI:

- стандартные reports работают;
- ручное создание task работает;
- пользователь видит понятное состояние, request ID и возможность повторить;
- незавершённый draft не применяется.

## 13. Миграция

### 13.1. Принцип

Source dump неизменяем. Импорт повторяем и идемпотентен:

```text
source snapshot
  → isolated restore/staging
  → profile and classify
  → transform
  → validate
  → target write + ledger atomically
  → conflicts/rejects
  → reconciliation
  → approved cutover
```

До ETL утверждается versioned `migration_scope_manifest`. Для каждой source entity он фиксирует:

- source system и snapshot checksum;
- table;
- primary-key shape;
- baseline count;
- selected columns;
- target entity/relation;
- inclusion/exclusion rule;
- transform version;
- reconciliation query.

Baseline текущего dump как минимум включает:

| Source | Count |
|---|---:|
| `b_user` | 218 |
| `b_crm_contact` | 3 186 |
| `b_crm_company` | 797 |
| `b_crm_deal` | 1 899 |
| `b_crm_dynamic_items_1042` | 1 808 |
| `b_tasks` | 89 |
| `b_tasks_member` | 187 |
| CRM activities | 7 737 |
| file metadata | 3 941 |
| `b_crm_deal_stage_history` | 4 619 |
| `b_crm_deal_stage_history_with_supposed` | 9 399, quarantine |
| `b_crm_entity_stage_history` | 3 201 |
| `b_crm_entity_stage_history_with_supposed` | 4 271, quarantine |
| `b_crm_observer` | 90 |
| `b_tasks_log` | 629 |
| `b_tasks_task_dep` | 4 |
| `b_tasks_stages` | 89 |
| `b_tasks_task_stage` | 174 |
| `b_tasks_result` | 3 |
| file ACL/storage sources | 1 789 |

Нормативный scope — контурная миграция identity/CRM/tracker, а не перенос всех
технических модулей Bitrix. Все `1 669` source tables получают disposition
`included|excluded|quarantine_only` с reason и owner. Исполнимый manifest
содержит `57` ledger tables: `55` included и `2` quarantine-only. Точный
знаменатель равен `438 424` строкам; quarantine-only строки входят в ledger и
обязаны получить outcome `quarantined`.

Каждая строка каждой included table получает ровно один row-level outcome:
`migrated|linked_existing|excluded_with_reason|conflict_recorded|quarantined`.
Ledger key:
`(snapshot_sha256, source_table, canonical_json(source_key), transform_version)`.
`100% ledger coverage` означает `438 424` distinct keys, `0` duplicate keys и
`0` missing source keys; filtered business values не уменьшают знаменатель
незаметно. `conflict_recorded`/`quarantined` учитываются как разобранные строки,
но блокируют cutover до решения или явно подписанного owner decision.

Изменение checksum/schema/count блокирует run до новой версии manifest.

Миграционная среда разделена:

- `raw_restore_quarantine` — изолированная зашифрованная копия source; она неизбежно содержит legacy hashes/tokens, но ETL не имеет права выбирать denylisted columns;
- `transform_staging` — только allowlisted поля; legacy secrets здесь должны отсутствовать;
- target — legacy secrets должны отсутствовать.

Доступ к quarantine/staging имеет минимальный список migration operators; production PII запрещена в developer environments; stdout/logs редактируются. Secret scan `= 0` применяется к transform staging, generated artifacts и target, а не ложно к неизменяемому raw dump. После подписания приёмки restore/staging очищаются по policy с audit purge event. Import historical data не отправляет email/Max/notifications.

### 13.2. Обязательные outcomes

Каждая source-запись included table получает:

- target ID;
- `merged_to`;
- `legacy_actor`;
- `manual_review`;
- `rejected` с reason;
- `excluded` с rule.

Silent drop запрещён.

`migration_ledger` имеет immutable source identity
`(snapshot_sha256, source_table, canonical_json(source_key), transform_version)`,
`run_id`, source checksum, target entity/ID, outcome, reason и timestamps. Новый
transform supersedes прежний outcome детерминированно и не создаёт второй
target. Все target entities получают provenance; `source_created_at` и
`imported_at` хранятся раздельно.

Semantic dedupe для нормализованных email/phone/content использует только
`HMAC-SHA-256` с обязательными `purpose` и `key_version`; ключ хранится во
внешнем secret manager. Unkeyed hash персонального идентификатора запрещён.
Raw input не попадает в ledger, generated artifacts, stdout, logs, metrics или
reconciliation samples. Обычный `SHA-256` checksum бинарного файла является
отдельным integrity-механизмом и не заменяет keyed semantic fingerprint.

Все `115` физических CRM `UF_*` колонок профилируются только aggregate-counts:
`36` имеют прямой canonical mapping, `7` заполненных UTS-полей являются
утверждёнными serialized mirrors для canonical `b_utm_*`, `63` заполненных
неразобранных поля уходят в зашифрованный field quarantine с field-specific
reason и решением `migration_data_owner`, `9` незаполненных исключаются.
Значения UF запрещены в generated artifacts и logs; pending решение хотя бы по
одному из 63 полей блокирует cutover.

### 13.3. Пользователи и сотрудники

- все 218 `b_user` попадают в classification ledger;
- active login создаётся только после кадрового/владельческого подтверждения;
- service/bot/connector не получает login;
- inactive employee сохраняется как historical employee/legacy actor;
- password/token поля denylisted;
- owner/author/responsible отношения мигрируются отдельно;
- неизвестный исторический actor не подменяется суперадмином.

Для текущих operational owners отдельный typed gate обрабатывает ровно
`458 contacts + 70 deals + 88 companies + 0 employer referrals + 1 task = 617`
назначений на inactive source employees. Legacy owner/actor остаётся
неизменяемым историческим фактом; новый operational owner допускается только
через подписанное ручное решение или подписанное versioned rule. Для каждой
записи сохраняются source key, old/new owner, rule version, reviewer, timestamp
и signature. `MIG-Q-OWNERS-001` обязан вернуть `617` signed outcomes и
`unresolved=0`; silent fallback на администратора запрещён.

Пять `b_uts_iblock_3_section` строк создают perioded relation
`identity.organization_unit_head(role=head)`: `VALUE_ID` указывает на
`identity.organization_unit`, `UF_HEAD` — на `identity.employee_profile`.
Relation хранит `valid_from/valid_to`, source key и provenance; inactive либо
неразрешённый head блокирует operational scope, но не переписывает историю.

### 13.4. Связи с кандидатами

Reconciliation отдельно считает:

- contact owner;
- case/deal assignee;
- deal-contact;
- employer referral assignee;
- activity responsible/author/editor;
- CRM task responsible/creator/member;
- project task responsible/creator/executors;
- timeline actor.

Каждая source relation имеет target relation или объяснимый outcome. Необъяснённых orphan после миграции — 0.

CRM history/observer contract:

- `b_crm_deal_stage_history`: `4 619 = 3 932` canonical
  `crm.case_stage_history` + `687` blocking conflicts по versioned
  category/stage classifier;
- `b_crm_entity_stage_history`: все `3 201` строки имеют
  `OWNER_TYPE_ID=1042`, category 8 и переходят в
  `crm.employer_referral_stage_history`;
- обе таблицы `*_with_supposed` (`9 399 + 4 271`) имеют только outcome
  `quarantined` до подписанного решения semantics и не создают canonical
  history;
- `b_crm_observer`: `16` deal observers создают perioded
  `crm.case_assignment(role=observer)`, `74` contact observers —
  `crm.crm_profile_assignment(role=observer)`.

Tracker history/stage contract:

- `b_tasks_log`: `629 = 399` typed CRM/project history + `230` blocking
  task-domain/current-task conflicts; девять отсутствующих user refs относятся
  только к system UF task events и разрешаются как `system_connector`, а не как
  выдуманный employee;
- `b_tasks_task_dep`: три `DIRECT=0` reflexive closure rows исключаются с
  reason; единственный `DIRECT=1` edge становится canonical dependency только
  после разрешения домена обеих задач и проверки отсутствия цикла;
- `b_tasks_stages`: 18 referenced definitions сохраняются как versioned source
  evidence, 71 unreferenced получают reasoned exclusion; canonical CRM/project
  workflow stage запрещено выводить из legacy `ENTITY_TYPE` без signed map;
- `b_tasks_task_stage`: все 174 строки сохраняются как non-perioded source
  membership evidence; timestamp/history не фабрикуется;
- `b_tasks_result`: три защищённых результата относятся к CRM task и
  мигрируют в `crm.task_result`; текст не выводится в logs/artifacts;
- `b_tasks.STAGE_ID`: 73 zero sentinels + 16 non-zero валидных ссылок; только
  15 однозначных project pointers можно классифицировать сразу, один остаётся
  в task-domain conflict.

`b_tasks_member.TYPE` покрыт полностью: `A=co_executor` — 9,
`O=originator` — 89, `R=responsible` — 89, unknown — 0/blocking. Все три типа,
включая `A`, наследуют versioned task-domain classifier:
`crm.task_assignment` для CRM и `project.task_assignment` для project; до
решения домена relation получает `conflict_recorded`.

Legacy field 206 создаёт только `crm.consent_snapshot`:
`legacy_boolean_value` nullable, `policy_version=null|unknown`,
`captured_at=null`, если source не доказывает timestamp, плюс source key и
provenance. Этот snapshot не является текущим юридическим разрешением и не
фабрикует consent version/date.

### 13.5. Файлы

Для заявления «полная миграция» отсутствие `/upload` является blocking gate. Metadata-only outcome не считается мигрированным файлом.

Без `/upload` в rehearsal:

- metadata импортируется только с флагом `binary_missing`;
- запись попадает в file reconciliation;
- UI не показывает ложную ссылку скачивания;
- production cutover блокируется.

Gate D status `FULL_MIGRATION_READY` требует согласованные DB и `/upload`
snapshots с отдельными signed `db_snapshot_id`/`upload_snapshot_id` на одном
`freeze_watermark` и 100% binary, binding, checksum, storage, effective ACL и
malware reconciliation. File ledger хранит source binding, checksum/size,
target object/version, ACL, malware result и outcome.

ACL/storage denominator включает `b_disk_right=284`,
`b_disk_simple_right=1 276`, `b_disk_sharing=8`, `b_disk_storage=221`.
Каждая ACL строка получает `platform.attachment_acl` либо signed blocking
conflict; storage — `platform.attachment_storage` либо conflict. Unknown
principal, orphan object/storage, ACL mismatch или malware blocker должны быть
равны нулю. Числовой `b_disk_right.TASK_ID` нельзя копировать как permission:
требуется versioned owner-approved crosswalk и `unknown_task_id_count=0`.

Известные unresolved `2 b_disk_object.FILE_ID +
2 b_disk_version.FILE_ID + 5 activity attachment bindings` блокируют FULL до
разрешения. Две строки `b_disk_external_link` требуют signed outcome
`revoked_not_migrated|reissued_with_new_target_secret|excluded_with_signed_security_decision`;
legacy `HASH/PASSWORD/SALT` и старые link secrets не импортируются.

Письменное исключение владельца данных должно содержать точный список missing
binaries и явно менять итоговый статус на `PARTIAL_MIGRATION_ACCEPTED`; слово
«полная» после waiver запрещено. Metadata-only outcome не является
мигрированным файлом. Любой binary/ACL/storage/external-link waiver означает
только `PARTIAL_MIGRATION_ACCEPTED`; scope-change escape для FULL отсутствует.

### 13.6. Cutover gates

- свежий согласованный snapshot;
- checksum;
- dry-run;
- классификация 218 source users;
- 100% ledger coverage;
- 0 blocking rejects/conflicts;
- 0 unexplained orphan relations;
- 0 imported legacy secrets;
- file reconciliation;
- signed sample cards;
- rehearsal rollback;
- go/no-go;
- production freeze/CDC watermark;
- final delta до переключения;
- reconciliation на том же watermark;
- отсутствие dual-write/split-brain.

Перед final delta source переводится в согласованный read-only/freeze либо используется доказанный CDC/high-watermark. Final delta применяется до traffic switch. После switch запись в source запрещена.

Rollback разрешён только в фиксированное окно: target writes останавливаются, затем выполняется проверенный reverse-delta либо target changes формально отклоняются владельцем данных. Одновременная запись в source и target запрещена. До rehearsal фиксируются switch/rollback decision tree, ответственные, target backup и доказательство отсутствия потерянных изменений.

## 14. Интеграция с публичным сайтом

Публичный сайт не изменяется этим ТЗ. Кабинет предоставляет:

- `POST /public/v1/applications`;
- `POST /public/v1/uploads` при утверждённом file flow;
- `GET /public/v1/dictionaries/spheres`;
- idempotency key;
- application type `relocation|student`; `vacancy` не принимается этим
  baseline API без отдельной domain entity/state owner и нового contract
  version;
- source/UTM;
- consent version;
- request ID;
- structured JSON error;
- rate limit/antispam.

Intake edge и durable store/outbox независимы от основного CRM process,
включены в deployment/readiness/backup/restore. `2xx/202` возвращается только
после durable persistence. Если edge/store не сохранили запись, API возвращает
JSON `503` с request ID и не сообщает ложное принятие. Delivery в CRM —
at-least-once с idempotent consumer. Nginx не возвращает HTML вместо API error.

## 15. Информационная архитектура и маршруты

### 15.1. Общий shell

- sidebar;
- contextual header/breadcrumbs;
- global search;
- AI quick command;
- notifications;
- user/session menu.

Пункта «Сайт» во внутренней навигации нет.

### 15.2. Auth

- `/cabinet/login`;
- `/cabinet/mfa`;
- `/cabinet/recovery`;
- `/cabinet/change-password`;
- `/cabinet/sessions`.

### 15.3. CRM

- `/cabinet/crm/dashboard`;
- `/cabinet/crm/relocation`;
- `/cabinet/crm/students`;
- `/cabinet/crm/candidates`;
- `/cabinet/crm/cases/:id`;
- `/cabinet/crm/duplicates`;
- `/cabinet/crm/employers`;
- `/cabinet/crm/employers/:id`;
- `/cabinet/crm/tasks`;
- `/cabinet/crm/communications`;
- `/cabinet/crm/reports`;
- `/cabinet/crm/settings`.

### 15.4. Project tracker

- `/cabinet/projects/dashboard`;
- `/cabinet/projects/directions`;
- `/cabinet/projects/:id`;
- `/cabinet/projects/tasks`;
- `/cabinet/projects/kanban`;
- `/cabinet/projects/gantt`;
- `/cabinet/projects/workload`;
- `/cabinet/projects/settings`.

### 15.5. AI

- global quick command;
- context drawer inside case/project/task;
- `/cabinet/ai/reports`;
- bulk-task preview/result.

### 15.6. Superadmin/migration

- `/cabinet/admin/users`;
- `/cabinet/admin/users/new`;
- `/cabinet/admin/users/:id`;
- `/cabinet/admin/roles`;
- `/cabinet/admin/audit`;
- `/cabinet/admin/audit/:id`;
- `/cabinet/admin/integrations`;
- `/cabinet/admin/migration/runs`;
- `/cabinet/admin/migration/employees`;
- `/cabinet/admin/migration/conflicts`;
- `/cabinet/admin/migration/reconciliation`.

### 15.7. Route/surface coverage

Не каждый URL требует отдельного ImageGen-файла, но каждый требует positive/forbidden/persisted test:

| Route/surface | Reference family |
|---|---|
| own sessions | AUTH-01 + ADM-04 component pattern |
| change password | AUTH-03 state family |
| notifications drawer | FND-01 + PM-05 event family |
| `/cabinet/admin/roles` | ADM-02 |
| `/cabinet/admin/integrations` | CRM-10 + ADM-03 critical-confirm pattern |
| candidate/employer registry/detail | CRM-04/06 |
| direction/project/task registry/detail | PM-01/02/03 |

Route registry, API command registry, requirement crosswalk и automated tests проверяются на взаимное покрытие. Неиспользуемый route удаляется; orphan route без requirement/test запрещён.

## 16. UI и визуальная система

### 16.1. Основа

- Onest для заголовков;
- Manrope для интерфейсного текста;
- canvas `#F7FAFF`;
- white cards;
- navy `#06143B` / `#092358`;
- blue `#2B5DA8` / `#4C82CF`;
- coral `#EC194C` только для главного действия/критичного внимания;
- cyan `#59DCE6` для AI emphasis;
- green `#167955`;
- danger `#B42318`;
- холодные мягкие тени;
- radii 14–22 px, крупные панели до 32 px;
- тонкие line-icons из единой библиотеки.

Новый утверждённый master logo заменяет прежний временный текстовый masthead. До письменного выбора используется нейтральный текст «Курс на Север» без придуманного знака.

### 16.2. UX-инварианты

- одна главная операция на экране;
- таблица/карточки/filters сохраняют context;
- destructive/risky actions через preview;
- status не передаётся только цветом;
- focus видим;
- touch target не меньше 44×44 px;
- desktop-first 1440×1024;
- tablet и mobile преобразуют таблицы в карточки;
- horizontal scroll в критических mobile flows запрещён;
- loading/empty/error/stale/denied/conflict/archived обязательны.

### 16.3. Доступность

Цель — WCAG 2.2 AA:

- keyboard navigation;
- logical focus order;
- labels/descriptions/errors;
- contrast;
- zoom 200%;
- reduced motion;
- screen-reader names;
- charts имеют tabular alternative;
- Kanban имеет keyboard move-menu;
- Gantt имеет эквивалентный list/table view;
- sortable grids используют доступную семантику.

Приёмка: автоматический axe scan без critical/serious issues, ручной keyboard-only flow и согласованная пара screen reader/browser.

### 16.4. Проверка понятности новичку

Репрезентативные сотрудники без опыта CRM/трекеров выполняют:

- создание CRM task;
- создание project task;
- получение отчёта обычным UI;
- создание AI draft задачи;
- AI report с проверкой параметров.

Фиксируются success rate, время, число подсказок и P0/P1 usability defects. Пользователь не должен вводить ID, знать prompt syntax или технические названия полей. Dataset/dimensions/formula показываются простым резюме; технические детали доступны через progressive disclosure.

Gate C threshold: не менее `5` репрезентативных новичков; не менее `80%`
успешных first-attempt completion без подсказки модератора по каждому core flow;
`0` S0/S1 usability defects. До теста фиксируются median time limits для пяти
сценариев, script и de-identified observations; изменение script/threshold после
наблюдений запрещено без новой версии acceptance plan.

## 17. Нефункциональные требования

### 17.1. Производительность baseline

При согласованной номинальной нагрузке:

- app shell usable ≤ 2.5 s p75;
- standard API read p95 ≤ 500 ms;
- standard write p95 ≤ 1 s без внешней доставки;
- registry filter p95 ≤ 800 ms;
- report до 50 000 records ≤ 10 s с progress;
- AI draft показывает progress и timeout/fallback, целевой p95 ≤ 15 s.

Каждый performance result фиксирует dataset version/count, concurrency, warm/cold state, browser, device, network profile, API endpoint/query и percentile window. Без этого p75/p95 не является доказательством. Production sizing утверждает окончательные profiles, но prototype использует заранее записанный reproducible baseline.

### 17.2. Доступность и восстановление

Инженерный baseline, требующий формального подтверждения владельца:

- monthly availability: 99.5%;
- RPO: 15 min для database, 24 h для cold archive;
- RTO: 4 h;
- daily full + continuous/WAL backup;
- restore test не реже квартала и перед cutover;
- backup encrypted и хранится отдельно от primary host.

Integrated recovery matrix до Gate C/D отдельно фиксирует:

| Component | Consistency/backup | Restore evidence |
|---|---|---|
| PostgreSQL | WAL + base backup на общем recovery point | migrations, constraints, ledger/audit/outbox |
| object storage | versioned inventory + immutable copy | checksum, ACL, object/version links |
| audit WORM/checkpoints | append-only replica; signing-key metadata отдельно | chain/checkpoint verification без экспорта key |
| intake durable store/outbox | согласованный watermark с PostgreSQL | ни одна принятая заявка не потеряна/не удвоена |
| configuration/secrets | encrypted secret-store backup под раздельной custody | восстановление order без печати secret value |

Matrix содержит owner, method, cadence, RPO/RTO, key custody и строгий restore
order. Gate D требует integrated restore rehearsal, а не только восстановление
PostgreSQL.

### 17.3. Privacy/security

- TLS only;
- least privilege DB/app roles;
- secrets outside Git/images/logs;
- encryption at rest where supported;
- test environments use masked data;
- export permission independent from view;
- antivirus/type/size checks for uploads;
- dependency and container vulnerability checks;
- security headers and CSP;
- audit/redaction/retention.

Migration staging использует encryption, минимальные operator permissions, access audit и purge policy. Production PII не копируется в обычные developer environments.

AI provider по умолчанию получает aggregates и masked fields. Передача raw PII возможна только при отдельном permission, утверждённой цели, регионе обработки, no-training/retention policy и видимом пользователю scope. AI prompts/responses проходят redaction и lifecycle policy.

### 17.4. Наблюдаемость

Metrics:

- API latency/error;
- DB connections/locks/storage;
- worker/outbox lag;
- integration success/retry/failure;
- AI latency/cost/fallback;
- migration throughput/reject/conflict;
- object storage health/free space;
- auth failures/lockouts;
- backup age/restore result.

Каждая пользовательская recoverable error показывает request ID.

## 18. API-инварианты

- versioned routes;
- OpenAPI is executable contract;
- JSON error `{code, message, requestId, details?}`;
- permissions validated in service layer;
- idempotency key on externally retried writes;
- optimistic version on mutable aggregates;
- pagination with stable cursor where needed;
- timestamps UTC, display in user timezone;
- soft archive for business records;
- no secrets/PII in URL;
- bulk operations return per-item outcome;
- public and internal auth/policies separated.

## 19. Тестовая стратегия

### 19.1. Автоматические уровни

- unit: normalization, policies, formulae, state machines;
- database: migrations, constraints, append-only enforcement;
- API integration: auth/RBAC/idempotency/conflicts;
- contract: OpenAPI request/response;
- E2E: core role journeys;
- migration: transform + ledger + reconciliation;
- accessibility;
- visual regression against approved references.

### 19.2. Обязательные негативные тесты

- CRM role opens tracker URL/API;
- project executor opens another project;
- user assigns own superadmin role;
- last superadmin disable;
- password reset token reused;
- revoked session writes;
- kanban bypasses required field;
- two users edit same version;
- AI writes without confirm;
- repeated AI/import/outbox command duplicates record;
- audit update/delete;
- source secret appears in target;
- orphan relation after migration;
- API route returns HTML.

### 19.3. Severity

| Severity | Определение | Gate |
|---|---|---|
| S0 | потеря/утечка данных, обход auth, необратимая corruption | release/cutover запрещён |
| S1 | основной сценарий/миграция/роль не работает без безопасного workaround | release запрещён |
| S2 | частичный дефект с безопасным workaround | решение владельца до релиза |
| S3 | косметика/некритичное удобство | может быть принято в backlog |

## 20. Доказательства приёмки

Готовность не подтверждается фразой «работает». Требуется пакет:

- route/screen inventory;
- тестовые пользователи по ролям;
- E2E success + forbidden matrix;
- OpenAPI validation;
- DB schema/migration status;
- audit samples без PII;
- migration run/ledger/reconciliation report;
- secret scan;
- backup/restore evidence;
- integration retry evidence;
- AI draft/confirm/idempotency evidence;
- accessibility report;
- visual side-by-side reference/prototype comparisons;
- source code, architecture, schema, admin/user instructions.

Каждый requirement ID обязан иметь:

- route/surface;
- API query/domain command;
- positive test;
- forbidden test;
- persisted evidence;
- audit evidence;
- migration query при применимости.

CI блокирует release при пустой обязательной ячейке crosswalk.

Отдельный контрактный delivery stream хранит доказательства:

- 12-месячного hosting contour;
- очной презентации и обучения;
- admin/user manuals;
- ticket workflow;
- трёхмесячной поддержки.

SLA поддержки и незаполненные договором сроки приёмки/исправления должны быть письменно утверждены; их нельзя симулировать кодом прототипа.

## 21. Ворота готовности

### Gate A — `Spec approved`

- P0/P1 red-team findings закрыты или имеют письменный owner decision;
- authorization policy catalog определён: [human-readable](06-authorization-policy-catalog.md), [machine-readable](generated/authorization-policy-catalog.json);
- normative transitions определены: [human-readable](07-state-transition-catalog.md), [machine-readable](generated/state-transition-catalog.json);
- [migration scope manifest](generated/migration-scope-manifest.json) и staged DoD определены;
- [disposition всех source tables](generated/source-table-dispositions.csv),
  [disposition всех колонок included tables](generated/column-disposition-manifest.json),
  [исполняемые migration queries](generated/migration-query-registry.json) и
  [canonical target model](generated/target-model-registry.json) согласованы;
- [source field, funnel, activity and file map](generated/source-field-map.json) зафиксирован;
- [machine-readable requirement evidence contract](generated/requirements-crosswalk.csv) заполнен;
- [test/audit/query evidence ID registry](generated/evidence-id-registry.json)
  не содержит неизвестных ID или `N/A` без причины;
- consistency-pass crosswalk/routes/counts успешен.

Только после Gate A разрешено генерировать недостающие reference screens.

### Gate B — `Reference approved`

- 9 недостающих ImageGen-сценариев сформированы и визуально проверены;
- три logo concepts представлены;
- выбран logo master либо явно зафиксирован временный text masthead;
- screen inventory/reference manifest обновлён.

Только после Gate B разрешена реализация экранов.

### Gate C — `Prototype accepted`

- все внутренние сценарии работают с persisted data;
- auth/RBAC/superadmin/audit проходят negative tests;
- CRM и tracker независимы;
- AI draft/report безопасны;
- migration rehearsal dataset импортирован;
- visual/accessibility QA пройдены.

Gate C не означает production cutover.

### Gate D — `Migration/cutover ready`

- fresh snapshot и binaries;
- manifest coverage 100%;
- conflicts/rejects/orphans gates;
- final delta/freeze;
- rollback rehearsal;
- подписанный reconciliation и отдельный go/no-go.

## 22. Порядок реализации

1. Аудит и baseline.
2. ТЗ и requirement crosswalk.
3. Несколько red-team атак и перенос исправлений в ТЗ.
4. Дополнительные ImageGen-референсы для недостающих admin/auth/migration screens.
5. Три ImageGen-концепта логотипа и письменный выбор.
6. App shell, design tokens, auth, sessions, RBAC, superadmin, audit.
7. CRM domain and screens.
8. Project tracker domain and screens.
9. Deterministic reports.
10. AI read/explain, затем task draft/preview/confirm.
11. Migration staging/ETL/ledger/conflicts/reconciliation.
12. Runtime, negative security, migration and visual QA.
13. Fresh snapshot rehearsal, files, go/no-go и production cutover отдельным разрешённым этапом.

Нельзя начинать с декоративной вёрстки отдельных картинок до закрытия шагов 1–3.

## 23. Автоматизация и человеческий контроль

| Автоматизирует система | Подтверждает человек |
|---|---|
| нормализация и поиск дублей | merge/survivorship |
| расчёт SLA/overdue/KPI | изменение формул и исключений |
| маршрутизация intake | спорное назначение |
| retry email/Max | содержание и массовая отправка |
| миграционный transform | конфликт и cutover |
| AI structured draft | write/batch command |
| backup и мониторинг | инцидент, go/no-go и recovery |
| effective access preview | критическое назначение роли |

## 24. Внешние prerequisites для production

Прототип и миграционная репетиция могут быть выполнены без этих данных, но production cutover блокируется до получения:

- авторитетного кадрового списка;
- свежего source snapshot;
- каталога `/upload` с checksum;
- production domains/TLS;
- согласованных email/Max API и credentials;
- выбранного AI provider, региона обработки и privacy policy;
- утверждённых funnel stages/formulas;
- подписанного SLA/RPO/RTO;
- письменного выбора logo master.

## 25. Definition of Done

### 25.1. Prototype DoD

Внутренний prototype считается готовым к предъявлению, когда:

1. все маршруты каталога сценариев работают с реальными persisted changes;
2. CRM и tracker сохраняют независимые данные и права;
3. superadmin lifecycle, password reset, sessions и audit проходят негативные тесты;
4. AI строит deterministic report и создаёт task только после preview/confirm;
5. rehearsal import даёт migration outcomes и демонстрирует conflict queues;
6. legacy secrets в target отсутствуют;
7. approved visual references пройдены side-by-side;
8. S0/S1 дефектов нет;
9. documentation/evidence package сформирован;
10. файлы и UI публичного сайта не изменены; это подтверждено сравнением с
    task-start snapshot и path allowlist кабинета (не с потенциально грязным
    `HEAD`);
11. в рамках кабинета реализован только provider-side intake API: OpenAPI/consumer contract, idempotency, durable persistence, JSON errors и no-SPA-fallback.

Подключение и релиз реального публичного сайта являются отдельным workstream и не блокируют Prototype DoD.

### 25.2. Migration/cutover DoD

Полная миграция и production cutover считаются готовыми только когда:

1. все 218 source users имеют migration outcome;
2. типизированные связи сотрудников с CRM/project objects reconciled;
3. signed manifest coverage = 100%;
4. blocking migration rejects/conflicts = 0;
5. unexplained target orphans = 0;
6. legacy secrets в target отсутствуют;
7. для `FULL_MIGRATION_READY` `/upload` binaries, bindings, storage, ACL и
   malware result reconciled на том же watermark на 100%; любое подписанное
   исключение переводит результат только в `PARTIAL_MIGRATION_ACCEPTED`;
8. final delta/freeze и no-dual-write доказаны;
9. rollback rehearsal пройден;
10. reconciliation подписан и получен отдельный go/no-go.
