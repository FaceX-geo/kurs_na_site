# Каталог авторизационных политик

Версия: 1.3
Статус: нормативный baseline Gate A
Модель: deny-by-default

Машиноисполняемый источник истины:
`generated/authorization-policy-catalog.json`. Этот документ объясняет политику
человеку; CI проверяет, что каждая operation требований принадлежит ровно одному
permission, а каждый role/principal и critical reference зарегистрирован.
Machine SHA-256:
`8d88806db35381888dc3097064550f1201fcbdde88bc224dc53f0ce7da166786`.

## 1. Решение доступа

Любой internal query/command проходит один алгоритм:

```text
authenticated session
  → account/risk/credential/MFA state
  → registered command/query
  → permission code
  → role grants
  → scope membership + row predicate
  → negative rules
  → fresh-auth/four-eyes requirement
  → allow or deny
```

Route, OpenAPI operation или domain command без строки каталога запрещён. UI visibility не участвует в решении безопасности.

## 2. Scope predicates

| Scope | Predicate |
|---|---|
| `self` | `object.subject_user_id = actor.user_id` |
| `assigned` | активная assignment relation у actor |
| `team` | actor и object owner состоят в одной active team membership |
| `department` | object owner/case/project принадлежит выбранному active organization unit actor |
| `direction` | object.project принадлежит разрешённому direction membership |
| `project` | active project membership либо explicit project role |
| `all` | все объекты домена, но только при отдельном permission |
| `endpoint` | только зарегистрированный endpoint с anti-abuse policy; не даёт доступа к domain rows |

Membership имеет `valid_from`, `valid_to` и version. Policy decision сохраняет `policy_version`, `membership_version` и scope snapshot в audit. Изменение membership инвалидирует authorization cache.

## 3. Роли и границы

| Роль | Domain | Базовый scope | Не даёт автоматически |
|---|---|---|---|
| `platform_superadmin` | platform | all platform accounts + explicit all-scope CRM read/report | CRM case/task/communication writes и project business access |
| `crm_project_manager` | CRM | assigned | project tracker |
| `crm_lead_specialist` | CRM | team/department | platform/project admin |
| `crm_admin` | CRM | all CRM | platform accounts/project data |
| `crm_department_head` | CRM | department | CRM configuration по умолчанию |
| `project_admin` | project | all project | CRM/platform |
| `project_direction_lead` | project | direction | other directions/CRM |
| `project_manager` | project | project | other projects/CRM |
| `project_executor` | project | assigned | project administration/CRM |
| `migration_operator` | migration | selected run | password/role management |
| `audit_reader` | audit | assigned audit scope | underlying full business object |

## 4. Назначение ролей

| Target role | Proposer | Approver/guard |
|---|---|---|
| `platform_superadmin` | eligible `platform_superadmin` | другой eligible `platform_superadmin`, four-eyes |
| `crm_project_manager` | `crm_admin` | no self; scope within CRM owner authority |
| `crm_lead_specialist` | `crm_admin` | no self; reason |
| `crm_department_head` | `crm_admin` | no self; reason |
| первый `crm_admin` | eligible `platform_superadmin` | другой eligible superadmin + signed nomination; proposer/approver/subject различны; only while count=0 |
| следующий `crm_admin` | `platform_superadmin` | existing eligible `crm_admin`, no self, four-eyes |
| `project_executor` | `project_manager`/`project_admin` | scope within owned project |
| `project_manager` | `project_admin` | no self; project scope |
| `project_direction_lead` | `project_admin` | no self; direction scope |
| первый `project_admin` | eligible `platform_superadmin` | другой eligible superadmin + signed nomination; proposer/approver/subject различны; only while count=0 |
| следующий `project_admin` | `platform_superadmin` | existing eligible `project_admin`, no self, four-eyes |
| `migration_operator` | `platform_superadmin` | другой eligible superadmin, four-eyes |
| `audit_reader` | `platform_superadmin` | другой eligible superadmin, four-eyes |

Любое расширение permissions/scopes требует `actor_id != subject_id`. Сокращение собственных прав также запрещено, если нарушает last/second eligible superadmin или оставляет незавершённую critical approval без уполномоченного исполнителя.

Исключение существует только в незапущенном `bootstrap` state: trusted ceremony одновременно регистрирует двух разных будущих superadmins, каждый самостоятельно принимает invite и enroll MFA. Один bootstrap-account не может одобрить второго. После двух eligible accounts bootstrap закрывается необратимо. Single acceptance account разрешён только в non-production prototype и не может выполнять production critical operations.

После закрытия platform bootstrap одноразовые
`AssignInitialCrmAdmin`/`AssignInitialProjectAdmin` доступны только пока в
домене нет ни одного eligible admin. Первое успешное назначение необратимо
закрывает соответствующий bootstrap command. Обычные
`AssignCrmRole`/`AssignProjectRole` не могут назначать `crm_admin`/`project_admin`
и потому не обходят four-eyes. После появления первого domain admin следующие
администраторы назначаются только отдельными critical commands
`AssignCrmAdminRole`/`AssignProjectAdminRole`: предложение делает eligible
platform superadmin, подтверждает другой действующий eligible admin целевого
домена, а proposer, approver и subject обязаны быть тремя разными людьми.
Отзыв platform/CRM/project admin выполняется отдельной critical command только
после назначения преемника: после операции должны оставаться минимум два
eligible platform superadmin и минимум один eligible admin каждого домена.
Self-revoke, orphan critical approvals и revoke до назначения преемника
запрещены.

Обычные роли также имеют явные парные команды:
`AssignCrmRole`/`RevokeCrmRole`, `AssignProjectRole`/`RevokeProjectRole`,
`AssignMigrationRole`/`RevokeMigrationRole` и
`AssignAuditRole`/`RevokeAuditRole`. Замена набора не может неявно удалить роль.
Каждая mutation требует reason, effective-access preview, `expected_version`,
before/after audit с policy version и пересчёт либо отзыв privileged sessions.
Назначение и отзыв migration/audit roles остаются critical; активные runs,
audit scopes, operational ownership и approvals передаются до выполнения.

## 5. Platform/identity policies

| Permission | Query/command | Grants | Scope/guard |
|---|---|---|---|
| `identity.profile.read_self` | `GetOwnProfile` | all authenticated | `self` |
| `identity.profile.update_self` | `UpdateOwnProfile` | all authenticated | allowlisted fields, expected version |
| `identity.sessions.read_self` | `ListOwnSessions` | all authenticated | `self` |
| `identity.sessions.revoke_self` | `RevokeOwnSession(s)` | all authenticated | `self`, fresh auth for all |
| `identity.users.read` | `ListUsers`, `GetUser` | platform superadmin | masked PII allowlist |
| `identity.users.invite` | `InviteUser` | platform superadmin | actor != subject, reason |
| `identity.users.update` | `UpdateUserProfile` | platform superadmin | actor != subject for privilege-related fields |
| `identity.users.disable` | `DisableUser`, `ArchiveUser` | platform superadmin | critical + replacement-first для типизированной privileged-роли; after-count ≥2 platform, ≥1 CRM, ≥1 project, если subject имел роль; no orphan approvals/ownership |
| `identity.users.enable` | `EnableUser` | platform superadmin | expected version, eligibility checks |
| `identity.credentials.reset` | `RequestAdminPasswordReset` | platform superadmin | actor != subject, fresh MFA, reason, revoke tokens/sessions |
| `identity.mfa.reset` | `ResetUserMfa` | platform superadmin | actor != subject, four-eyes if privileged |
| `identity.sessions.read_all` | `ListUserSessions` | platform superadmin | reason, masked IP |
| `identity.sessions.revoke_all` | `RevokeUserSessions` | platform superadmin | actor != subject, reason |
| `identity.roles.preview` | `PreviewEffectiveAccess` | platform/domain role owner | subject in owned domain |
| `identity.roles.assign_platform` | `AssignPlatformRole` | platform superadmin | no self, four-eyes for superadmin |
| `identity.roles.assign_crm` | `AssignCrmRole` | CRM role owner | no self/admin bypass; reason, preview, expected version, session recalc |
| `identity.roles.revoke_crm` | `RevokeCrmRole` | CRM role owner | explicit removal; no self/admin bypass; reason, preview, expected version, ownership/session guards |
| `identity.roles.assign_project` | `AssignProjectRole` | project role owner | no self/admin bypass; reason, preview, expected version, session recalc |
| `identity.roles.revoke_project` | `RevokeProjectRole` | project role owner | explicit removal; no self/admin bypass; reason, preview, expected version, ownership/session guards |
| `identity.roles.assign_initial_crm_admin` | `AssignInitialCrmAdmin` | two eligible platform superadmins | count=0, signed nomination, three distinct people, four-eyes |
| `identity.roles.assign_initial_project_admin` | `AssignInitialProjectAdmin` | two eligible platform superadmins | count=0, signed nomination, three distinct people, four-eyes |
| `identity.roles.assign_crm_admin` | `AssignCrmAdminRole` | platform superadmin + existing eligible CRM admin approver | count≥1, no self, three distinct people, four-eyes |
| `identity.roles.assign_project_admin` | `AssignProjectAdminRole` | platform superadmin + existing eligible project admin approver | count≥1, no self, three distinct people, four-eyes |
| `identity.roles.revoke_platform` | `RevokePlatformRole` | platform superadmin + different eligible platform superadmin | replacement first, at least two eligible remain, no orphan approvals |
| `identity.roles.revoke_crm_admin` | `RevokeCrmAdminRole` | platform superadmin + different eligible CRM admin | replacement first, at least one eligible remains, three distinct people |
| `identity.roles.revoke_project_admin` | `RevokeProjectAdminRole` | platform superadmin + different eligible project admin | replacement first, at least one eligible remains, three distinct people |
| `identity.roles.assign_migration` | `AssignMigrationRole` | platform superadmin | no self, four-eyes |
| `identity.roles.revoke_migration` | `RevokeMigrationRole` | platform superadmin | no self, four-eyes, transfer active runs, preview/version/session/audit |
| `identity.roles.assign_audit` | `AssignAuditRole` | platform superadmin | no self, four-eyes |
| `identity.roles.revoke_audit` | `RevokeAuditRole` | platform superadmin | no self, four-eyes, transfer audit scope, preview/version/session/audit |
| `identity.approvals.read` | `ListApprovalRequests` | proposer/eligible approver/audit reader | payload masked |
| `identity.approvals.decide` | `ApproveOrRejectCriticalOperation` | eligible approver | proposer != approver, hash/expiry/version |
| `identity.breakglass.execute` | offline recovery | two-person recovery custodians | time-bound, WORM checkpoint |

## 6. CRM policies

| Permission | Query/command | Grants | Scope/guard |
|---|---|---|---|
| `crm.dashboard.read` | `GetCrmDashboard` | all CRM roles + platform superadmin | role scope; superadmin=`all` |
| `crm.case.list` | `ListCases` | all CRM roles + platform superadmin | assigned/team/department/all |
| `crm.case.read` | `GetCase` | all CRM roles + platform superadmin | row predicate + field mask |
| `crm.case.create` | `CreateCase` | manager/lead/admin | intake/manual permission |
| `crm.case.update` | `UpdateCase` | manager/lead/admin | expected version, row predicate |
| `crm.case.transition` | `TransitionCase` | manager/lead/admin | state-machine guard |
| `crm.case.reopen` | `ReopenCase` | lead/admin | required reason, expected version |
| `crm.person.pii_view` | sensitive contact fields | manager/lead/admin/head + platform superadmin | row predicate, view audit |
| `crm.person.export` | `ExportCandidates` | head/admin | independent export permission, reason |
| `crm.duplicates.read` | `ListDuplicateCandidates` | lead/admin | permitted data scope |
| `crm.duplicates.merge` | `MergeCandidate` | lead/admin | human reviewer, reason, reversible ledger |
| `crm.employer.read` | employer queries | CRM roles + platform superadmin | role scope; superadmin=`all` |
| `crm.employer.manage` | create/update employer | manager/lead/admin | INN conflict guard |
| `crm.employer.merge` | `MergeEmployer` | lead/admin | reason/audit |
| `crm.referral.manage` | employer direction commands | manager/lead/admin | state machine, row predicate |
| `crm.recommender.manage` | recommender link/doc commands | manager/lead/admin | deterministic link/manual review |
| `crm.task.read` | CRM task queries | CRM roles + platform superadmin | assigned/team/department/all |
| `crm.task.manage` | CRM task commands | manager/lead/admin | CRM task only, expected version |
| `crm.communication.read` | communication queries | CRM roles + platform superadmin | row predicate; superadmin=`all` |
| `crm.notification.read` | own notification queries/read receipt | CRM roles + platform superadmin | recipient remains actor; permission opens the personal screen |
| `crm.communication.send_one` | send single | manager/lead/admin | preview, idempotency |
| `crm.communication.send_bulk` | send batch | lead/admin | selection hash, confirm, per-item outcome |
| `crm.report.build` | build/read report | lead/admin/head + platform superadmin | scope + versioned formula; superadmin=`all` |
| `crm.report.export` | report export | head/admin | separate export permission |
| `crm.settings.manage` | funnel/fields/integrations | CRM admin | critical changes need fresh auth |
| `crm.roles.define` | CRM permission templates | CRM admin | cannot assign own role |

`platform_superadmin` получает только перечисленный CRM read/report allowlist. Он не наследует
`crm.case.transition`, `crm.case.reopen`, `crm.task.manage` или communication write permissions.
`crm_project_manager` получает свои зарегистрированные `crm.*`, но не `project.*`. CRM admin не получает
`identity.roles.assign_platform`.

## 7. Project policies

| Permission | Query/command | Grants | Scope/guard |
|---|---|---|---|
| `project.dashboard.read` | portfolio/workload/plan-fact | project roles | direction/project/assigned/all |
| `project.direction.read` | direction queries | project roles | role scope |
| `project.direction.manage` | direction commands | project admin | all project |
| `project.project.read` | project queries | project roles | membership predicate |
| `project.project.manage` | project create/update/archive | admin/direction lead/manager | owned scope, no cycle |
| `project.task.read` | task queries | project roles | assigned/project/direction/all |
| `project.task.create` | create project task | admin/lead/manager | project scope |
| `project.task.update` | edit task | admin/lead/manager/responsible | expected version, field policy |
| `project.task.transition` | status command | project roles | state-machine guard |
| `project.task.assign` | change responsible/executors | admin/lead/manager | target membership valid |
| `project.task.comment` | add comment | visible project roles | no hidden PII |
| `project.task.archive` | archive task | admin/lead/manager | reason/dependency guard |
| `project.file.manage` | attachment commands | project roles | object access + scan |
| `project.report.read` | workload/plan-fact reports | admin/lead/manager | scope |
| `project.report.export` | export | admin/lead | separate permission |
| `project.settings.manage` | project role/event definitions | project admin | fresh auth |
| `project.roles.assign_scoped` | executor/manager scoped assignment | project admin/authorized manager | no self escalation |

`project_manager` не получает `crm.*` даже при одинаковом display label.

## 8. AI policies

| Permission | Query/command | Grants | Scope/guard |
|---|---|---|---|
| `ai.assist.read` | summarize/search | any domain user | inherits underlying read permissions |
| `ai.report.draft` | build report draft | domain report reader | formula allowlist |
| `ai.task.draft_crm` | CRM task draft | CRM task creator | no write |
| `ai.task.draft_project` | project task draft | project task creator | no write |
| `ai.batch.draft` | build batch draft | domain batch creator | selection fingerprint, no business write/outbox |
| `ai.report.confirm` | confirm report draft | same human report reader | hash/expiry/RBAC/version recheck |
| `ai.task.confirm_domain` | confirm CRM или project draft | same human actor | domain-specific RBAC, versions, hash и expiry recheck |
| `ai.batch.confirm` | confirm batch | domain batch permission | per-item recheck |
| `ai.pii.unmasked` | send raw PII to provider | explicitly approved roles only | policy/data region/no-training |

AI service account не имеет business write permission. Confirm вызывает обычный domain command от имени человека.

## 9. Migration/audit/integration policies

| Permission | Query/command | Grants | Scope/guard |
|---|---|---|---|
| `migration.run.read` | list/detail runs | migration operator/audit reader | assigned run/audit scope |
| `migration.run.execute` | dry-run/import | migration operator | manifest/checksum, no self approval for cutover |
| `migration.conflict.read` | conflict queue | migration operator | assigned run |
| `migration.conflict.resolve` | resolve conflict | migration operator | human reason, expected version |
| `migration.reconciliation.read` | reports | migration operator/audit reader | assigned run |
| `migration.cutover.propose` | propose go/no-go | migration operator | all gates green |
| `migration.cutover.execute` | switch | designated release owner | signed go/no-go + four-eyes |
| `migration.rollback.execute` | rollback | designated release owner | approved rollback window + reverse delta/owner decision |
| `migration.employee.classify` | classify legacy actor | migration operator | manifest/evidence, expected version |
| `migration.employee.review` | employee account eligibility | migration operator | no automatic account creation |
| `migration.employee.associations.build` | typed employee relations | migration operator | perioded relation + provenance; no identity merge |
| `migration.file.import` | import binary | migration operator | synchronized snapshot/checksum/scan/ACL |
| `migration.file.reconcile` | file coverage | migration operator/audit reader | FULL requires zero unresolved |
| `migration.security.scan` | target legacy-secret scan | migration/platform ops | redacted result, zero matches |
| `audit.events.read` | audit registry/detail | audit reader | approved audit scope, redaction |
| `audit.events.export` | audit export | audit reader | separate export permission + export event |
| `audit.events.mutate` | any update/delete | nobody/application | always deny |
| `integration.status.read` | health/status | CRM/project admin + platform ops | no secret values |
| `integration.config.manage` | config metadata | domain admin | fresh auth |
| `integration.secret.rotate` | rotate secret | designated platform ops | four-eyes, value never audited |

Pre-auth, challenge, derived and service actors are not implicit roles. They are
registered under `principals` with authentication mode, owner, scope, grant
path, TTL/rotation and `ui_assignable`. Service principals cannot be issued from
the admin UI. `anonymous_client`, `mfa_challenge_subject`,
`public_intake_client` and `health_probe` are endpoint-scoped and never inherit
business-domain reads or writes.

`explicit_ai_pii_role`, `designated_release_owner` и
`designated_platform_ops` не являются постоянными UI-ролями. Это
auto-expiring `approval_scoped_subject`: он возникает только из действующего
`approved_request_id` с зафиксированными `actor_id`, `payload_hash`,
`approved_operation`, `approved_permission`, точным scope и `expires_at`,
действует для одной операции/релизного окна и не может быть назначен через
карточку пользователя. Каждое permission, которое включает такой principal,
на каждом использовании обязано проверить единый binding
request+actor+payload+operation+permission+scope+expiry; для mixed-role
permission это условие включается при approval-scoped grant path.

## 10. Mandatory negative rules

1. No self-escalation in any domain.
2. No direct URL/API bypass.
3. No platform role implying business PII.
4. No view permission implying export permission.
5. No project role implying CRM role, or vice versa.
6. No AI permission exceeding underlying domain permission.
7. No disabled/locked/archived account request.
8. No stale membership cache after org/project change.
9. No role/scope mutation without reason/audit.
10. No audit mutation.
11. No last/two-superadmin invariant violation.
12. No migration cutover by the same sole proposer.
13. No hidden assignment to inactive employee.
14. No notification payload revealing inaccessible object.
15. No implicit ordinary-role removal while replacing a role set.
16. No approval-scoped grant whose request, actor, payload, operation, permission, scope or expiry does not match.

## 11. Consistency gate

Before implementation and in CI:

- every OpenAPI operation has registered command/query;
- every command/query has one permission row;
- every permission is granted to an explicit role or intentionally unused;
- every scope has a row predicate test;
- every critical permission has approval policy;
- every ordinary role assignment has an explicit revoke permission and lifecycle test;
- every approval-scoped consuming permission has request/actor/payload/operation/permission/scope/expiry binding;
- every permission has at least one allow test and one deny test;
- unregistered command test returns deny.
