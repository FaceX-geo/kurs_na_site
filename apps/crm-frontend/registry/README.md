# UI Registry — CRM «Курс на Север»

Реестр превращает 51 экран референса в проверяемый контракт между дизайном,
frontend и готовым backend. Он не является вторым runtime и не хранит бизнес-данные.

## Состав

- `components.json` — публичные CRM-owned компоненты, их владельцы и артефакты;
- `contracts/*.contract.json` — варианты, состояния, входы, события, доступность,
  motion и инварианты каждого компонента;
- `snippets/*.tsx` — компилируемые примеры использования только через
  `@/shared/ui`;
- `screens.json` — все 51 экрана reference pack, маршруты, shell, состояние
  backend-контракта и точные `operationId`;
- `recipes.json` — повторяемые композиции: shell, реестр, Kanban/list, Entity 360,
  guarded operation, auth/MAX test boundary и системные состояния.

## Источники истины

1. Визуальная и сценарная полнота: `crm-complete-interface-pack-v5` и его
   `SCREEN-INVENTORY.md`.
2. Backend-возможности: `../crm-backend/openapi/openapi.json`.
3. Runtime-компоненты: `src/shared/ui` и публичный экспорт `@/shared/ui`.
4. Контракт изменения данных: `draft → preview → confirm → execute → receipt`.

В реестре нельзя создавать `operationId` «на будущее». Если backend не имеет
контракта, экран остаётся `contract-gap` с пустым `operationIds`.

## Проверка

Из `apps/crm-frontend`:

```bash
npm run registry:check
npx tsc -p registry/tsconfig.json
```

Проверка подтверждает:

- ровно 51 уникальный экран и полное покрытие recipes;
- один contract и один snippet для каждого компонента;
- существование каждого `operationId` в текущем backend OpenAPI;
- изоляцию auth-экранов 45–48 от CRM shell и CRM-данных;
- отсутствие подмены TOTP-операции `EnrollMfa` интеграцией MAX;
- запрет project-role и migration endpoints в CRM-сценариях;
- отсутствие runtime-import из соседнего Tracker-репозитория.

## Изменение реестра

1. Сначала определить человеческий результат и экран reference pack.
2. Проверить точный backend `operationId` в OpenAPI.
3. Обновить или добавить component contract.
4. Обновить публичный компонент и snippet через `@/shared/ui`.
5. Привязать экран и recipe.
6. Запустить `npm run registry:check`, typecheck, lint и тесты.

Если меняется backend-контракт, frontend не угадывает новую схему. Сначала
версионируется OpenAPI, затем обновляются generated API types и этот реестр.

## Provenance и границы

Из Tracker взят только проверяемый принцип «registry + contract + snippet» и
адаптирован в локальные CRM-owned артефакты. Код, маршруты, сущности, граф,
стили и runtime-зависимости Tracker сюда не импортируются. Компоненты CRM имеют
собственный API, визуальные токены и ответственность.
