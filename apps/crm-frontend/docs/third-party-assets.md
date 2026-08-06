# Third-party UI dependencies

Foundation использует только зависимости, уже зафиксированные в
`package-lock.json`:

| Пакет | Зафиксированная версия | Лицензия | Использование |
| --- | ---: | --- | --- |
| `@fontsource-variable/onest` | 5.3.0 | OFL-1.1 | локально поставляемый variable font |
| `@tabler/icons-react` | 3.44.0 | MIT | доступные React icon components |
| `react` | 19.2.0 | MIT | UI runtime |
| `vite` | 6.4.2 | MIT | build и local development |

Из соседнего продукта не копируются изображения, шрифты, иконки, CSS или
компонентный runtime. Перед релизом third-party notices формируются из lockfile,
а не из этой памятки; таблица фиксирует проверенное состояние foundation на
момент его создания.
