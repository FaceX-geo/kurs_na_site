# Канонический transform foundation CRM

## Статус и назначение

Этот контур превращает проверяемый срез legacy Bitrix в детерминированный **dry-run план** для
канонической CRM. Он снимает ручную сверку пригодности строк, фиксирует конфликты стабильными
reason codes и показывает 1:N намерения записи в target model. Он намеренно не изменяет
`identity.*`, `crm.*`, `project.*` и другие канонические таблицы.

Текущий статус: семь самых ценных source tables имеют исполнимые versioned classifiers,
зависимости, точные контрольные суммы запросов и подтверждённые агрегаты на исходном dump. Реальный
import остаётся fail-closed.

## Контракт выполнения

Источник истины состоит из трёх согласованных частей:

- `docs/cabinet/generated/migration-scope-manifest.json` — scope, зависимости, версия transform и
  ожидаемое распределение проекций;
- `docs/cabinet/generated/migration-query-registry.json` — read-only count/extraction SQL и SHA-256;
- `apps/crm-backend/src/modules/migration/canonical-transform-registry.ts` — исполнимые правила и
  безопасные target intents.

План строится топологически: actor → contact/company → contact point/requisite → case, а task
зависит от actor. Неизвестная версия transform, несовпадение manifest/registry, отсутствующая
classifier column, drift row count или drift projection count останавливают прогон.

Проекция строки имеет одно из четырёх значений:

- `would_migrate` — правила допускают будущую каноническую запись;
- `would_quarantine` — нужен подписанный выбор владельца процесса;
- `would_conflict` — обнаружена нарушенная связь, неоднозначность или duplicate signal;
- `would_exclude` — строка доказанно вне утверждённого канонического scope.

Это прогноз, а не факт импорта. Для обратной совместимости `migration.ledger` хранит
`would_migrate` как `quarantined` с `DRY_RUN_WOULD_MIGRATE`; first-class projection и история
попыток находятся в `migration.ledger_attempt`, а 1:N target intents — в
`migration.ledger_target`. Ledger содержит только SHA-256 digests, типы targets и стабильные коды;
raw source row, контактные значения и другие PII туда не попадают.

## Подтверждённый bounded scope

Сверка выполнена на неизменяемом dump с SHA-256
`7d38354b78f7c30423462799f088f097cd129eb3934b4e29b3664b0f648e79bf`.

| Source table | Rows | would_migrate | would_quarantine | would_conflict | would_exclude |
| --- | ---: | ---: | ---: | ---: | ---: |
| `b_user` | 218 | 217 | 0 | 1 | 0 |
| `b_crm_contact` | 3 186 | 2 088 | 458 | 640 | 0 |
| `b_crm_company` | 797 | 709 | 88 | 0 | 0 |
| `b_crm_field_multi` | 7 753 | 4 089 | 2 091 | 952 | 621 |
| `b_crm_requisite` | 426 | 331 | 46 | 43 | 6 |
| `b_crm_deal` | 1 899 | 1 237 | 123 | 539 | 0 |
| `b_tasks` | 89 | 61 | 1 | 27 | 0 |
| **Итого** | **14 368** | **8 732** | **2 807** | **2 202** | **627** |

Из 14 368 строк получено 24 931 target intent: 18 287 `would_migrate`, 2 807
`would_quarantine` и 3 837 `would_conflict`. Это ожидаемая 1:N проекция; например, один contact
может породить person, CRM profile и assignment. Target IDs ещё не создаются.

Остальные зарегистрированные source tables пока fail-closed в `would_quarantine`. Поэтому общий
план в 438 424 строки не является готовым import plan.

## Воспроизводимая проверка

Все MySQL операции read-only. Подключения и секреты передаются через secret manager/локальное
окружение и не попадают в командные примеры, логи или Git.

```sh
cd apps/crm-backend
LEGACY_MYSQL_URL=... pnpm migration:verify-projections
```

Команда должна вернуть `PROJECTIONS_VERIFIED`, точные агрегаты выше и `canImport: false`.

Для записи только privacy-safe ledger metadata в **изолированную** PostgreSQL требуется явное
операторское подтверждение:

```sh
cd apps/crm-backend
MIGRATION_REHEARSAL_APPROVED=true \
  LEGACY_MYSQL_URL=... \
  DATABASE_URL=... \
  pnpm migration:rehearse-transforms
```

Ожидаемый признак: `TRANSFORM_REHEARSAL_COMPLETED`, `canonicalTargetWrites: 0` и те же 14 368
строк. Повторный запуск проверяет immutable identity/idempotency, но не считается production
cutover.

## Что остаётся до реального импорта

1. Получить свежий point-in-time-consistent snapshot и повторить registry/count/hash verification.
2. Устранить denominator drift и закрыть внешние links/leads, которые сейчас являются blocking
   preflight issues.
3. Подписать решения по ownership, duplicate merge, funnel/category mapping и task domain.
4. Добавить отдельный transactional canonical/staging unit of work для этих семи transforms:
   `resolve/link/create`, optimistic checks, reconciliation и rollback proof.
5. Довести отсутствующие target schemas/contracts, затем прогнать import rehearsal только в
   изолированной базе и доказать counts, referential integrity, idempotent replay и нулевую утечку
   PII.
6. Только после human approval снять `canImport=false` отдельным проверяемым изменением. Dry-run
   код не должен автоматически превращаться в production import.

## Контроль человека

Алгоритм классифицирует повторяемое и собирает безопасную доказательную базу. Человек сохраняет
контроль над объединением дублей, переназначением неактивных владельцев, трактовкой воронок,
разделением CRM/project tasks и самим cutover. Эти решения нельзя выводить из legacy эвристик.
