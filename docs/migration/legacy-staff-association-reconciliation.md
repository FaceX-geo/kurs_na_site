# Legacy staff association reconciliation

## Цель

Связать доказуемое назначение Bitrix с каноническим `identity.employee_profile`, не теряя
неизменяемую ссылку на `migration.legacy_actor`. Это делает migrated cases видимыми для
`assigned`/`team` row scope и одновременно сохраняет provenance для аудита.

Контур не импортирует новые сущности, не переносит legacy credentials/roles и не снимает общий
`canImport=false` gate.

## Проверенная исходная точка

Источник: `sitemanager-final.sql.gz`, SHA-256
`7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`.
Потоковая read-only сверка не выводила имена, email, телефоны или иные PII.

| Метрика | Количество |
|---|---:|
| Legacy users | 218 |
| Пользователи с department link | 20 |
| Доказуемые employee profiles со структурированным именем | 19 |
| Активные из них | 13 |
| Неактивные из них | 6 |
| Department-linked conflict без структурированного имени | 1 |
| Category-2 cases, проходящие bounded materializer | 1 237 |
| Активные специалисты-владельцы этих cases | 8 |
| Dynamic 1042 rows | 1 808 у 7 активных специалистов |
| CRM tasks bounded materializer | 38 строк сохранены; 37 имеют case или employee association; 1 не имеет обеих связей |

Source association стабилен: `b_user.ID` является PK, а ownership хранится в
`ASSIGNED_BY_ID`/`RESPONSIBLE_ID`. В проверенном dump ссылки `dynamic1042.assigned` и
`task.responsible` имеют ноль orphan references. Все 1 237 bounded cases принадлежат восьми
активным employee identities.

## Исправляемый дефект

До migration `0161` test materializer создавал `crm.case_assignment` только с
`legacy_actor_id`. SQL scope читает `employee_profile_id`, поэтому специалист с ролью
`assigned`/`team` не мог увидеть доказуемо назначенные ему legacy cases.

Migration `0161_legacy_staff_associations`:

1. разрешает хранить обе ссылки в одном assignment;
2. backfill-ит `employee_profile_id` только из
   `migration.legacy_actor.employee_profile_id`;
3. trigger-ом запрещает несовпадающую пару;
4. сохраняет `legacy_actor_id` и provenance;
5. считает owner действующим только при текущем interval assignment на активный,
   неархивированный `employee_profile`;
6. кладёт ownerless cases, ownership на inactive/archived employee и legacy task без обеих
   canonical links в privacy-safe `migration.staff_association_conflict`;
7. публикует агрегированный reconciliation view без PII.

`b_crm_dynamic_items_1042` намеренно не импортируется этой migration: связь с владельцем
доказана, но mapping business entity/funnel ещё не подписан.

## Repeatable reconciliation

Команда требует migrator `DATABASE_URL` и выполняет только детерминированный backfill,
синхронизацию ownerless queue и агрегированную проверку:

```sh
cd apps/crm-backend
DATABASE_URL=postgresql://kurs_crm_migrator:...@postgres:5432/kurs_crm \
  pnpm migration:reconcile-staff-associations
```

В собранном Bravo image её можно выполнить без нового сервиса:

```sh
docker --context remote-build compose --env-file /secure/path/crm.env \
  run --rm --no-deps migrate node dist/staff-association-reconcile-once.js
```

Безопасный результат:

- `mismatchedStaffAssignmentRows = 0`;
- `legacyOnlyAssignmentRows = 0`;
- `resolvableLegacyOnlyRows = 0`;
- `caseAssociationReviewRows = queuedCaseReviewRows`;
- `unassociatedLegacyTaskRows = queuedUnassociatedTaskRows`;
- `validActiveOwnerAssignmentRows` учитывает только current assignment на активного,
  неархивированного сотрудника;
- известные ownerless case и unassociated task дают `readiness=review_required`, остаются в
  durable queue и не маскируются как успешно ассоциированные.

Exit code `0` означает выполненные invariants и полное покрытие обеих review queues, включая
`review_required`; `2` — mismatch/legacy-only/неполное queue coverage; `1` — ошибка выполнения.
Отчёт содержит только counts и технические статусы.

Для release используется обязательный one-shot gate. Он запускает reconciliation дважды,
требует `backfilledRows=0` на втором проходе и одинаковые aggregates. Полностью покрытый
`review_required` разрешает rollout, но остаётся явным human-in-the-loop долгом; `invalid` или
недетерминированный повтор блокирует API:

```sh
docker --context remote-build compose --env-file /secure/path/crm.env \
  run --rm --no-deps migrate
docker --context remote-build compose --env-file /secure/path/crm.env \
  run --rm --no-deps staff-association-release-gate
```

Обе команды используют существующий PostgreSQL и не пересоздают его container/volume.

## Deployment gates

1. Зафиксировать backup PostgreSQL и доказать restore до изменения production.
2. Проверить `db:status` и checksum уже применённых migrations.
3. Применить forward migrations migrator-ролью через one-shot `migrate` без recreate PostgreSQL.
4. Запустить `staff-association-release-gate`; он сам выполняет reconciliation дважды, второй
   проход должен дать `backfilledRows=0` и те же counts.
5. Проверить отдельными сессиями: superadmin/global scope, specialist assigned scope, запрет
   чужого case и отсутствие PII в логах.
6. Ownerless case назначает человек через явный workflow, а unassociated task связывает с case
   или employee; после этого повторный gate переводит queue entries в `resolved`.
7. Down migration допустима только по общему destructive rollback protocol; она удаляет
   каноническую вторую ссылку, но сохраняет `legacy_actor_id`.

Этот gate доказывает association seam, но не означает полный legacy cutover: content, dynamic 1042,
история, документы и остальные quarantined tables остаются отдельными решениями.
