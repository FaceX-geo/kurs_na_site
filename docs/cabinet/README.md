# Внутренний кабинет «Курс на Север»

Статус: Gate A `PASS`; Gate B — подготовка и проверка визуальных референсов
Дата: 29.07.2026

## Граница текущей работы

Текущий контур — только внутренняя система:

- CRM кандидатов на переезд и студентов;
- самостоятельный проектный трекер;
- ИИ-помощник для отчётов, сводок и создания задач;
- платформенное администрирование пользователей, ролей, паролей и сессий;
- неизменяемый журнал действий;
- миграция релевантных данных и связей из Bitrix.

Публичный сайт разрабатывается отдельным потоком и не входит в реализацию кабинета. Кабинет должен только принимать заявки сайта через версионированный API и сохранять источник/UTM. Текущий публичный `index.html`, его стили и сценарии нельзя переписывать в рамках кабинета.

Полноценная ERP также не входит в действующий договор: бухгалтерия, закупки, склад, зарплата, казначейство и финансовое закрытие периода остаются вне текущего объёма.

## Документы и порядок прохождения ворот

1. [Аудит текущего состояния](00-current-state-audit.md).
2. [Продуктово-техническое задание](01-product-technical-spec.md).
3. [Матрица требований и доказательств](02-requirements-crosswalk.md).
4. [Red-team проверка ТЗ](03-red-team-review.md).
5. [Карта идентичности и миграции](04-migration-identity-map.md).
6. [Каталог пользовательских сценариев и экранов](05-scenario-catalog.md).
7. [Каталог авторизационных политик](06-authorization-policy-catalog.md).
8. [Каталог состояний и переходов](07-state-transition-catalog.md).

Machine-readable baseline:

- [authorization-policy-catalog.json](generated/authorization-policy-catalog.json);
- [state-transition-catalog.json](generated/state-transition-catalog.json);
- [migration-scope-manifest.json](generated/migration-scope-manifest.json);
- [source-table-dispositions.csv](generated/source-table-dispositions.csv);
- [column-disposition-manifest.json](generated/column-disposition-manifest.json);
- [migration-query-registry.json](generated/migration-query-registry.json);
- [target-model-registry.json](generated/target-model-registry.json);
- [source-field-map.json](generated/source-field-map.json);
- [requirements-crosswalk.csv](generated/requirements-crosswalk.csv);
- [evidence-id-registry.json](generated/evidence-id-registry.json).

Проверка согласованности:

```bash
node scripts/cabinet/validate-spec-baseline.mjs
```

Детерминированное обновление generated registries:

```bash
node scripts/cabinet/generate-migration-registries.mjs
node scripts/cabinet/generate-evidence-registry.mjs
node scripts/cabinet/validate-spec-baseline.mjs
```

Реализация начинается только после того, как:

- фактическое состояние репозитория, runtime, договора, дампа и референсов зафиксировано;
- каждое требование имеет класс и проверяемое доказательство;
- ТЗ прошло атаки по безопасности, идентичности, бизнес-процессам, миграции, эксплуатации и UX;
- критические замечания red-team перенесены обратно в ТЗ;
- определены сценарии суперадмина, журналирования и переноса связей сотрудников;
- публичный сайт явно исключён из изменяемого контура.

## Классы требований

| Код | Значение |
|---|---|
| `CONTRACT` | Прямое требование договора и его ТЗ |
| `USER-EXPANSION` | Явное расширение, подтверждённое пользователем |
| `ENGINEERING-CONTROL` | Обеспечивающая мера безопасности, надёжности или проверяемости |
| `OUT-OF-SCOPE` | Не входит в текущий кабинет |

## Источники истины

- подписанный договор и приложение ТЗ, страницы 7–13;
- дамп `sitemanager-final.sql.gz` с проверенной контрольной суммой;
- [анализ базы](../migration/database-analysis.md);
- [миграционный runbook](../migration/migration-runbook.md);
- [контрактный продуктовый контур](../migration/contract-product-blueprint.md);
- [спецификация ИИ-помощника](../migration/ai-assistant-blueprint.md);
- [24 существующих и 9 запланированных сценарных референсов](../design/kurs-na-sever-system-reference/README.md);
- фактический код и runtime репозитория на Bravo.

Ни один визуальный референс сам по себе не является доказательством работоспособности. Приёмка требует работающего сценария, проверки API/данных/прав и визуального сравнения с референсом в одинаковом состоянии и viewport.

## Текущий результат Gate A

- три независимых red-team раунда завершены;
- residual `P0 = 0`, `P1 = 0`;
- auth/RBAC strict re-pass завершён со статусом `PASS`;
- migration/state/identity consistency-pass завершён со статусом `PASS`;
- `node scripts/cabinet/validate-spec-baseline.mjs` проверяет текущий
  human/machine baseline и завершается со статусом `PASSED`.

Gate A подтверждает внутреннюю согласованность ТЗ. Gate B отдельно требует
создать, проверить и утвердить девять недостающих сценарных экранов и выбрать
один master-логотип до переноса знака в рабочий интерфейс.
