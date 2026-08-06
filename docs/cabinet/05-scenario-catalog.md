# Каталог пользовательских сценариев и экранов

Статус: визуальный и функциональный inventory
Дата: 29.07.2026
Целевой набор: 33 сценарных референса

## 1. Правило покрытия

Экран считается покрытым, если:

- у него есть одна главная пользовательская задача;
- маршрут и роль определены;
- основной сценарий работает с persisted data;
- предусмотрены loading/empty/stale/validation/denied/recoverable error;
- рискованное действие имеет preview/confirm;
- responsive-трансформация не теряет главное действие;
- есть утверждённый визуальный референс;
- визуальная реализация сравнена с референсом в одинаковом viewport.

## 2. Общий shell

| ID | Экран | Маршрут/поверхность | Основной актор | Статус референса |
|---|---|---|---|---|
| FND-01 | Design language, shell и service states | все внутренние маршруты | все роли | существует |

FND-01 задаёт sidebar, header, breadcrumbs, search, AI command, notification и session menu. Навигация показывает только разрешённые domains. Пункт «Администрирование» виден уполномоченным ролям; «Миграция» — только migration/audit roles. Пункта публичного сайта нет.

## 3. CRM

| ID | Экран | Маршрут | Главная задача | Статус |
|---|---|---|---|---|
| CRM-01 | Персональный dashboard | `/cabinet/crm/dashboard` | понять задачи, просрочки и ближайшие события | существует |
| CRM-02 | Воронка «Переезд» | `/cabinet/crm/relocation` | управлять стадиями в list/kanban | существует |
| CRM-03 | Воронка «Студенты» | `/cabinet/crm/students` | вести отдельный student flow | существует |
| CRM-04 | Candidate 360 + duplicate review | `/cabinet/crm/cases/:id` | увидеть контекст и безопасно разобрать дубль | существует |
| CRM-05 | Program tabs | `/cabinet/crm/cases/:id` | «Маяк» / работодатели / переезд | существует |
| CRM-06 | Employers master-detail | `/cabinet/crm/employers` | найти компанию, контакты и направления | существует |
| CRM-07 | CRM tasks | `/cabinet/crm/tasks` | создать/вести CRM task | существует |
| CRM-08 | Communications | `/cabinet/crm/communications` | письмо/Max и безопасная массовая отправка | существует |
| CRM-09 | Reports center | `/cabinet/crm/reports` | построить проверяемый отчёт | существует |
| CRM-10 | CRM settings/RBAC/integrations | `/cabinet/crm/settings` | настроить только CRM domain | существует |

Уточнения:

- CRM-02/03 используют серверную state machine и optimistic lock;
- CRM-04 merge требует reason/reviewer;
- CRM-08 batch preview показывает per-item result;
- CRM-09 всегда показывает formula version и freshness;
- в CRM-10 вкладка «Сайт» заменяется на «Интеграция сайта» и содержит только intake API/source mapping, не CMS.

## 4. Проектный трекер

| ID | Экран | Маршрут | Главная задача | Статус |
|---|---|---|---|---|
| PM-01 | Портфель | `/cabinet/projects/dashboard` | направления, health, нагрузка, план-факт | существует |
| PM-02 | Project + Gantt | `/cabinet/projects/:id` | сроки, зависимости, milestone health | существует |
| PM-03 | Project tasks list + card | `/cabinet/projects/tasks` | найти и детально вести задачу | существует |
| PM-04 | Project Kanban | `/cabinet/projects/kanban` | менять status с проверкой правил | существует |
| PM-05 | Project roles/notifications | `/cabinet/projects/settings` | определить project roles/scopes/events | существует |

Уточнения:

- PM-05 определяет роли домена, но назначение роли пользователю происходит в ADM-02;
- `responsible` и `executors` отображаются раздельно;
- overdue — вычисляемый badge;
- CRM task не может появиться здесь без явного read-only link типа внешнего объекта.

## 5. ИИ

| ID | Экран | Поверхность | Главная задача | Статус |
|---|---|---|---|---|
| AI-01 | Quick task command | global command | создать одну задачу обычной фразой | существует |
| AI-02 | Context assistant | case/project/task drawer | получить сводку с источниками | существует |
| AI-03 | Report builder | `/cabinet/ai/reports` | построить deterministic report фразой | существует |
| AI-04 | Bulk task drafts | modal/workspace | проверить и подтвердить пакет задач | существует |

Для всех AI-сценариев:

- scope виден до запуска;
- draft не меняет business-domain data; до confirm разрешены только redacted
  `ai_request`, immutable `ai_draft` и audit persistence;
- до confirm запрещены outbox-команды и внешние side effects;
- write только после confirm;
- permission наследуется;
- ошибка модели не блокирует стандартный UI;
- результат содержит deep link и audit reference.

## 6. Миграционный контур

| ID | Экран | Маршрут | Главная задача | Статус |
|---|---|---|---|---|
| MIG-01 | Import control | `/cabinet/admin/migration/runs` | snapshot, run, wave, dry-run, counters | существует |
| MIG-02 | Conflict/reject queue | `/cabinet/admin/migration/conflicts` | разобрать неоднозначную запись | существует |
| MIG-03 | Reconciliation/cutover | `/cabinet/admin/migration/reconciliation` | доказать готовность и go/no-go | существует |
| MIG-04 | Employees and relations | `/cabinet/admin/migration/employees` | сопоставить users и сохранить связи | существует |

MIG-04 должен показывать master-detail:

- слева source user classification и target account/legacy actor;
- справа coverage связей по типам;
- exact/ambiguous/missing/inactive/duplicate;
- invite/disabled state;
- unresolved owner queue;
- idempotency/run ID;
- blocking gates и drill-down без избыточной PII.

## 7. Auth и восстановление доступа

| ID | Экран | Маршрут | Главная задача | Статус |
|---|---|---|---|---|
| AUTH-01 | Вход | `/cabinet/login` | безопасно войти/вернуться к deep link | существует |
| AUTH-02 | MFA | `/cabinet/mfa` | проверить TOTP/recovery code | существует |
| AUTH-03 | Восстановление | `/cabinet/recovery` | запросить link и установить новый пароль | существует |

### AUTH-01 states

- default/focus;
- required field errors;
- neutral invalid credentials;
- rate limit;
- locked/disabled без account enumeration;
- server error + request ID;
- session expired с сохранённым draft;
- successful deep-link return.

### AUTH-02 states

- correct/invalid/expired/rate-limited code;
- one-time recovery code;
- no-device recovery path;
- новый TOTP берётся из приложения и не «переотправляется»;
- audit of verification/fail/recovery.

Enrollment — отдельное состояние настройки учётной записи после password
re-auth. Оно не смешивается с reference screen AUTH-02 verification; QR/TOTP
secret никогда не попадают в визуальные тестовые артефакты.

### AUTH-03 states

- одинаковый response для known/unknown email;
- valid/expired/used/revoked token;
- password rules visible;
- confirm mismatch;
- revoke other sessions;
- successful return to login.

## 8. Суперадмин

| ID | Экран | Маршрут | Главная задача | Статус |
|---|---|---|---|---|
| ADM-01 | Пользователи | `/cabinet/admin/users` | найти, пригласить и изменить status | существует |
| ADM-02 | Роли/effective access | `/cabinet/admin/users/:id?tab=roles` | безопасно назначить и явно отозвать независимые роли | существует |
| ADM-03 | Пароль и безопасность | `/cabinet/admin/users/:id?tab=security` | reset/unlock/MFA reset с причиной | существует |
| ADM-04 | Активные сессии | `/cabinet/admin/users/:id?tab=sessions` | увидеть и отозвать сессии | существует |
| ADM-05 | Полный audit log | `/cabinet/admin/audit` | расследовать неизменяемую историю | существует |

### ADM-01 states

- invited/active/locked/disabled/password-change/MFA-required;
- search/filters/department/source/last activity;
- create drawer;
- email/login conflict;
- resend invite;
- disable impact preview;
- owned cases/tasks before reassignment;
- last superadmin protection;
- loading/empty/stale/denied/error.

### ADM-02 states

- separate Platform/CRM/Projects/Migration/Audit;
- direct/inherited/scope/effective access;
- «Что увидит пользователь» preview;
- reason and second approval for critical role;
- self-escalation/last-superadmin denial;
- replacement-first preview for revoking platform/CRM/project admin;
- minimum two eligible platform superadmins and one eligible admin per domain after revoke;
- отдельные ordinary-role revoke actions для CRM/project;
- critical assign/revoke migration и audit roles с передачей активных runs/scopes;
- reason, effective-access preview, expected version, session recalculation;
- before/after и `identity.role_assignment_changed` audit с policy version;
- cancelled/failed attempt.

### ADM-03 states

- current password never visible;
- reset link, force change, unlock, MFA reset;
- reason/impact preview;
- second approval for privileged MFA reset;
- old reset link invalidation;
- notification delivery state;
- audit without secret.

### ADM-04 states

- device/browser/masked IP/created/last active/MFA/risk;
- admin-view не помечает строку как «текущий сеанс»;
- revoke one/all sessions of the target user;
- consequence preview;
- token invalidation;
- target user returns to login; administrator session remains active;
- suspicious-device flag;
- loading/empty/stale/denied/error.

### ADM-05 states

- filters by actor/target/domain/event/time/result;
- IP/session/request ID/auth method;
- redacted before/after;
- reason/approver/four-eyes;
- success/failure;
- integrity/retention;
- export with masking;
- no edit/delete controls.

## 9. Responsive

| ID | Экран | Viewports | Главная задача | Статус |
|---|---|---|---|---|
| RSP-01 | Critical-flow responsive plate | tablet + mobile | доказать безопасную трансформацию | существует |

RSP-01 покрывает candidate detail, CRM cards, project task cards и AI confirm. Новые auth/admin экраны дополнительно проверяются кодом на:

- 390 px mobile;
- 768 px tablet;
- 1280/1440 px desktop;
- отсутствие critical horizontal scroll;
- touch target ≥ 44 px.

## 10. Добавленный набор ImageGen

Сгенерированы девять отдельных high-fidelity reference screens:

1. AUTH-01;
2. AUTH-02;
3. AUTH-03;
4. ADM-01;
5. ADM-02;
6. ADM-03;
7. ADM-04;
8. ADM-05;
9. MIG-04.

Каждая генерация наследует foundation prompt существующего набора и содержит
только синтетические данные. Это не collage; один файл — один focused screen.

Отдельно сгенерированы три концепта логотипа. Они не входят в число 33
сценарных экранов и не заменяют reference screen. До выбора пользователя
сценарные экраны продолжают использовать нейтральный текстовый masthead.
