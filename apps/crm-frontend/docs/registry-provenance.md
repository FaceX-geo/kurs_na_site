# Provenance UI foundation

## Что адаптировано

Из отдельного продукта команды адаптирован организационный паттерн:

- component registry как единая карта публичного UI;
- machine-readable contract на variants, states, inputs, events и invariants;
- executable snippet через публичный barrel-export;
- проверяющий скрипт, который связывает screen, component и backend contract.

Это внутренняя адаптация идеи, а не перенос runtime-кода. Реализация, API
компонентов, CSS tokens и документация созданы и принадлежат CRM frontend.

## Что не переносится

- filesystem imports из соседнего репозитория;
- его routes, entities, registry IDs и domain terminology;
- graph/canvas runtime и его зависимости;
- visual language, если он противоречит CRM reference pack;
- server state, fixtures и API assumptions.

## Почему так

Локальное владение сохраняет автономность приложений и позволяет обновлять
соседний продукт без скрытого breaking change CRM. Проверяемый паттерн снимает
повторяемую ручную сверку, а versioned contracts оставляют команде прозрачный
контроль над смыслом и риском каждого изменения.
