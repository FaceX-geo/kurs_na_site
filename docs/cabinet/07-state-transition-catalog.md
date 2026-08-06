# Каталог состояний и переходов

Версия: 1.2
Статус: нормативный baseline Gate A
Concurrency: optimistic locking, expected aggregate version

Машиноисполняемый источник истины:
`generated/state-transition-catalog.json`. Обозначения вроде `open`,
`nonterminal` и `pre-cutover` ниже являются только читаемыми именами
зарегистрированных `state_sets`; wildcard и строки с `|` в JSON запрещены.
Каждый переход в набор разворачивается валидатором в конкретные пары состояний.
Machine SHA-256:
`3c36c766b9cc215804ba96fb256b45be8d9d178d953991be3502fd8aff26db5a`.

## 1. Общие инварианты

Каждый переход:

- выполняется server-side domain command;
- требует permission и row predicate;
- проверяет `expected_version`;
- проверяет обязательные поля;
- сохраняет aggregate, history, audit и outbox одной transaction;
- возвращает `409 VERSION_CONFLICT` при устаревшей версии;
- не использует silent last-write-wins;
- имеет idempotency key, если запрос может повториться;
- сохраняет human actor, даже если draft подготовил AI.

Kanban drag-and-drop, modal form, API и AI confirm вызывают один и тот же transition command.

## 2. CRM funnel «Переезд»

Prototype baseline; название/обязательность можно изменить только новой version после согласования владельца процесса.

| From | To | Permission | Required/guard | Reason | Side effects |
|---|---|---|---|---|---|
| — | `new` | `crm.case.create` | application/source/consent | нет | owner routing, intake event |
| `new` | `qualification` | `crm.case.transition` | owner, next step | нет | task/notification by rule |
| `qualification` | `documents` | `crm.case.transition` | program type, normalized contacts | нет | document checklist |
| `documents` | `employer_selection` | `crm.case.transition` | document decision, recommender review when applicable | если exception | notify owner |
| `employer_selection` | `employer_review` | `crm.case.transition` | at least one employer referral | нет | referral outbox |
| `employer_review` | `offer` | `crm.case.transition` | accepted/approved referral | нет | manager notification |
| `offer` | `relocation_preparation` | `crm.case.transition` | employer, job title, agreement result | нет | relocation checklist |
| `relocation_preparation` | `moved` | `crm.case.transition` | municipality, locality, actual date, employer, position | нет | completion event/report |
| любой открытый | `closed_unsuccessful` | `crm.case.transition` | closure reason code | да | cancel pending reminders |
| `closed_unsuccessful` | предыдущий открытый | `crm.case.reopen` | lead/admin, target stage | да | reopen notification |
| `moved` | `relocation_preparation` | `crm.case.reopen` | lead/admin, correction evidence | да | report restatement event |

Skipping stages разрешён только отдельной transition row новой version. UI не может произвольно указать `to`.

## 3. CRM funnel «Студенты»

| From | To | Permission | Required/guard | Reason | Side effects |
|---|---|---|---|---|---|
| — | `new` | `crm.case.create` | student application/source/consent | нет | owner routing |
| `new` | `qualification` | `crm.case.transition` | owner, education data minimum | нет | next-step task |
| `qualification` | `practice_selection` | `crm.case.transition` | specialization/direction | нет | search notification |
| `practice_selection` | `host_review` | `crm.case.transition` | host/referral | нет | referral outbox |
| `host_review` | `placement_confirmed` | `crm.case.transition` | accepted host + dates | нет | confirmation notification |
| `placement_confirmed` | `in_practice` | `crm.case.transition` | actual start date | нет | active-practice event |
| `in_practice` | `completed` | `crm.case.transition` | result, actual end date | нет | report event |
| любой открытый | `closed_unsuccessful` | `crm.case.transition` | closure reason | да | cancel pending reminders |
| closed/completed | предыдущий открытый | `crm.case.reopen` | lead/admin | да | restatement event |

## 4. CRM task

Stored states:

- `to_do`;
- `in_progress`;
- `done`;
- `cancelled`.

`is_overdue` вычисляется из due date/calendar и не является manual state.

| From | To | Permission | Guard | Reason | Side effects |
|---|---|---|---|---|---|
| — | `to_do` | `crm.task.manage` | title, responsible, due date, linked CRM object | нет | assignment notification |
| `to_do` | `in_progress` | `crm.task.manage` | actor visible/assigned | нет | start history |
| `in_progress` | `done` | `crm.task.manage` | completion note if configured | нет | close reminder |
| `to_do`/`in_progress` | `cancelled` | `crm.task.manage` | no dependent critical action | да | cancel notification |
| `done`/`cancelled` | `to_do` | `crm.task.manage` | lead/admin or responsible policy | да | reopen notification |

Responsible is one accountable employee; participants do not replace responsible.

## 5. Document check

States:

- `not_requested`;
- `requested`;
- `received`;
- `accepted`;
- `rejected`;
- `expired`.

| From | To | Permission | Guard/reason |
|---|---|---|---|
| `not_requested` | `requested` | `crm.recommender.manage` | document type |
| `requested` | `received` | `crm.recommender.manage` | attachment/provenance |
| `received` | `accepted` | `crm.recommender.manage` | reviewer |
| `received` | `rejected` | `crm.recommender.manage` | reason required |
| `accepted` | `expired` | system rule | expiry date, system event |
| `rejected`/`expired` | `requested` | `crm.recommender.manage` | reason/re-request |

Accepted/rejected/expired change produces timeline and audit event.

## 6. Employer referral

Target vocabulary:

- `draft`;
- `sent`;
- `feedback_requested`;
- `interview`;
- `reserved`;
- `approved`;
- `accepted`;
- `rejected_by_employer`;
- `rejected_by_candidate`;
- `ignored`;
- `cancelled`.

Legacy stage сохраняется в provenance и маппится отдельной versioned table.

| From | To | Permission | Guard/reason |
|---|---|---|---|
| — | `draft` | `crm.referral.manage` | candidate, employer, owner |
| `draft` | `sent` | `crm.referral.manage` | message/referral date |
| `sent` | `feedback_requested` | `crm.referral.manage` | follow-up rule |
| `sent`/`feedback_requested` | `interview` | `crm.referral.manage` | interview data |
| `sent`/`feedback_requested`/`interview` | `reserved` | `crm.referral.manage` | note |
| `interview`/`reserved` | `approved` | `crm.referral.manage` | employer decision |
| `approved` | `accepted` | `crm.referral.manage` | candidate acceptance |
| open | `rejected_by_employer` | `crm.referral.manage` | reason required |
| open | `rejected_by_candidate` | `crm.referral.manage` | reason required |
| open | `ignored` | `crm.referral.manage` | attempt history required |
| open | `cancelled` | `crm.referral.manage` | reason required |
| `accepted`/`rejected_by_employer`/`rejected_by_candidate`/`ignored`/`cancelled` | `approved` | `crm.referral.manage` + lead/admin guard | reason + history reference required |

## 7. Project task

Stored contract states:

- `to_do` — «К работе»;
- `in_progress` — «В работе»;
- `review` — «На проверке»;
- `done` — «Выполнена».

`is_overdue` — вычисляемый contract badge.

| From | To | Permission | Guard | Reason | Side effects |
|---|---|---|---|---|---|
| — | `to_do` | `project.task.create` | title, project, responsible, planned end | нет | assignment notification |
| `to_do` | `in_progress` | `project.task.transition` | actor can work task | нет | start event |
| `in_progress` | `review` | `project.task.transition` | review owner exists | нет | reviewer notification |
| `review` | `done` | `project.task.transition` | acceptance/checklist rule | нет | completion event |
| `review` | `in_progress` | `project.task.transition` | reviewer feedback | да | assignee notification |
| `done` | `in_progress` | `project.task.transition` | manager/admin | да | reopen/report restatement |

Archive — отдельная command, не status; blocked — derived from dependencies, не manual status.

## 8. User account

Состояния независимы.

### 8.1. `account_state`

| From | To | Permission | Guard |
|---|---|---|---|
| — | `active` | `identity.users.invite` | account unique, invite token |
| `active` | `disabled` | `identity.users.disable` | impact gate; для типизированной privileged-роли — critical approval и replacement-first; после операции остаются ≥2 eligible `platform_superadmin`, ≥1 eligible `crm_admin`, ≥1 eligible `project_admin` для тех ролей, которые были у subject; orphaned critical approvals запрещены |
| `disabled` | `active` | `identity.users.enable` | owner queue resolved, credential/MFA valid |
| `active`/`disabled` | `archived` | `identity.users.disable` | для типизированной privileged-роли — critical approval и replacement-first; те же after-count ≥2/≥1/≥1; no active ownership и no orphaned critical approvals; reason |
| `archived` | `disabled` | `identity.breakglass.execute` | two-person offline ceremony, reason, recovery evidence |

### 8.2. `credential_state`

| From | To | Trigger/guard |
|---|---|---|
| — | `invited` | one-time hashed invite |
| `invited` | `password_set` | token valid, password policy |
| `password_set` | `change_required` | admin reset/security rule |
| `change_required` | `password_set` | successful change + session rotation |
| any credential | `expired` | policy/incident |
| `expired` | `password_set` | valid recovery |

### 8.3. `risk_state`

| From | To | Trigger/guard |
|---|---|---|
| `normal` | `locked` | rate/risk rule; revoke sessions if critical |
| `locked` | `normal` | cooldown or admin unlock with fresh auth/reason |

### 8.4. `mfa_state`

| From | To | Trigger/guard |
|---|---|---|
| `not_enrolled` | `enrollment_required` | privileged role/explicit policy |
| `enrollment_required` | `enrolled` | fresh password, valid TOTP, recovery codes issued once |
| `enrolled` | `recovery_required` | approved MFA reset/incident |
| `recovery_required` | `enrolled` | new enrollment |

`disabled|archived|locked` deny every authenticated request. Privilege change rotates privileged sessions. Administrative reset revokes all sessions and invite/reset tokens.

## 9. Critical approval request

States:

Допустимый успешный путь: `pending → approved → executed`.
`rejected`, `expired`, `executed` и `cancelled` являются terminal; выполнить
операцию после reject/expiry/cancel невозможно.

| From | To | Guard |
|---|---|---|
| — | `pending` | immutable payload hash, proposer, expiry |
| `pending` | `approved` | different eligible approver, permission recheck |
| `pending` | `rejected` | different eligible approver, reason |
| `pending` | `expired` | server time ≥ expiry |
| `pending` | `cancelled` | proposer or payload invalidation |
| `approved` | `executed` | one-time idempotent execute, hash unchanged, permission recheck |
| `approved` | `cancelled` | payload/version/permission changed |

`executed` terminal; repeated execute returns original result.

## 10. Migration run

States:

- `created`;
- `profiling`;
- `dry_running`;
- `awaiting_conflicts`;
- `ready_for_rehearsal`;
- `rehearsing`;
- `ready_for_cutover`;
- `cutting_over`;
- `completed`;
- `failed`;
- `rolled_back`;
- `cancelled`.

| From | To | Guard |
|---|---|---|
| `created` | `profiling` | checksum + manifest version |
| `profiling` | `dry_running` | source schema/count matches manifest |
| `dry_running` | `awaiting_conflicts` | run complete, blocking items exist |
| `dry_running` | `ready_for_rehearsal` | coverage 100%, no blocking items |
| `awaiting_conflicts` | `ready_for_rehearsal` | all blocking items resolved |
| `ready_for_rehearsal` | `rehearsing` | target backup, approved window |
| `rehearsing` | `ready_for_cutover` | rollback rehearsal + reconciliation pass |
| `ready_for_cutover` | `cutting_over` | fresh snapshot/freeze/final delta/signed go-no-go |
| `cutting_over` | `completed` | traffic switch + post-switch verification |
| active | `failed` | blocking failure with checkpoint |
| `cutting_over`/`completed` | `rolled_back` | decision tree + reverse delta/owner decision |
| pre-cutover | `cancelled` | reason |

Failed run never reports success; retry creates new attempt bound to the same source identity and transform version.

## 11. Migration conflict

States:

- `open`;
- `assigned`;
- `resolved`;
- `rejected`;
- `waived`;
- `superseded`.

| From | To | Guard |
|---|---|---|
| — | `open` | typed reason/source evidence |
| `open` | `assigned` | active operator |
| `assigned` | `resolved` | resolution payload, reviewer, expected version |
| `assigned` | `rejected` | reason |
| `assigned` | `waived` | data owner approval; exact scope effect |
| any open | `superseded` | newer deterministic evidence/manifest version |

`waived` не уменьшает знаменатель незаметно: manifest/DoD показывает signed exception.

## 12. AI draft

States:

- `drafting`;
- `needs_input`;
- `ready`;
- `confirmed`;
- `executing`;
- `completed`;
- `partially_completed`;
- `invalidated`;
- `expired`;
- `cancelled`;
- `failed`.

| From | To | Guard |
|---|---|---|
| — | `drafting` | actor/context/scope |
| `drafting` | `needs_input` | missing mandatory value |
| `needs_input` | `drafting` | human clarification |
| `drafting` | `ready` | deterministic validation + immutable hash |
| `ready` | `confirmed` | same human, unexpired, versions/RBAC/hash recheck |
| `confirmed` | `executing` | one-time idempotency key |
| `executing` | `completed` | all items final |
| `executing` | `partially_completed` | per-item mixed results |
| nonterminal | `invalidated` | data/permission/scope/payload changed |
| nonterminal | `expired` | TTL |
| pre-execute | `cancelled` | human cancel |
| `executing` | `failed` | no hidden write beyond recorded per-item results |

AI model is never actor. `created_by` is the confirming human; `creation_origin=ai`.

## 13. Batch job item

States:

- `pending`;
- `validated`;
- `created`;
- `skipped`;
- `conflict`;
- `forbidden`;
- `failed`;
- `cancelled`.

Permission, membership, object version and selection membership are rechecked before each item. Retry accepts only `conflict|failed` items explicitly selected and never duplicates `created`.

## 14. Message delivery

States:

- `draft`;
- `confirmed`;
- `queued`;
- `sending`;
- `sent`;
- `delivered`;
- `failed_retryable`;
- `failed_terminal`;
- `cancelled`.

| From | To | Guard/side effect |
|---|---|---|
| `draft` | `confirmed` | human preview/confirm |
| `confirmed` | `queued` | outbox transaction + idempotency key |
| `queued` | `sending` | worker lease |
| `sending` | `sent` | provider accepted |
| `sent` | `delivered` | delivery callback |
| `sending`/`sent` | `failed_retryable` | retry policy |
| `failed_retryable` | `queued` | same idempotency key, backoff |
| active | `failed_terminal` | retry exhausted/nonretryable |
| pre-send | `cancelled` | no provider submission |

Одно business message имеет один provider idempotency/fingerprint; retry не создаёт новую timeline activity.

## 15. Transition consistency gate

До реализации и в CI:

- каждый mutable aggregate зарегистрирован;
- каждый stored state имеет вход/выход либо явно terminal;
- каждый переход имеет allow/deny test;
- каждый переход проверяет expected version;
- каждая critical transition пишет audit;
- каждая external side effect использует outbox;
- API, UI, Kanban и AI не имеют обходного update endpoint;
- неизвестный `to_state` возвращает deterministic validation error.
