# Аудит и план переработки frontend CRM

Статус: gates F1–F3 пройдены локально; exact-SHA deploy и публичная role-based
проверка F4 выполняются отдельно

Дата: 07.08.2026

## 1. Бизнес-цель

Переработка нужна не ради нового оформления. CRM должна сокращать время от
сигнала до управленческого решения:

- специалист видит только свой рабочий контур, быстро находит просроченные и
  требующие решения заявки, меняет стадию через проверяемый сценарий и не теряет
  контекст при возврате на экран;
- суперпользователь видит весь разрешённый CRM-контур, пользователей, вакансии,
  истории и операционные показатели, но не получает неявных прав на бизнес-
  команды;
- длинные реестры не обрезаются первыми `N` строками, фильтры и страница
  восстанавливаются по URL, а на мобильном экране интерфейс не превращается в
  горизонтально прокручиваемую таблицу;
- автоматизация снимает повторяемую навигацию и подготовку данных, но критичное
  изменение остаётся под контролем человека: запрос → проверка → preview →
  подтверждение → серверный результат.

Целевой результат — не набор отдельных красивых экранов, а наблюдаемая рабочая
система с явными API-контрактами, RBAC, сервисными состояниями, воспроизводимой
навигацией и проверяемой визуальной приёмкой.

## 2. Граница и источники доказательств

### 2.1. Что проверено

Аудит выполнен по четырём независимым источникам:

1. фактический frontend в `apps/crm-frontend/`;
2. локальный запуск текущего frontend с синтетическим API fixture;
3. PDF v5 и его экранный реестр;
4. OpenAPI/RBAC backend и отдельный репозиторий Tracker как reference только для
   повторно применимых interaction-паттернов.

Снимки исходного состояния:

- публичный экран входа:
  `apps/crm-frontend/tmp/audit/2026-08-07/01-live-login.jpg`;
- локальный dashboard:
  `apps/crm-frontend/tmp/audit/2026-08-07/02-current-dashboard.jpg`;
- локальный Kanban:
  `apps/crm-frontend/tmp/audit/2026-08-07/03-current-kanban.jpg`;
- локальный реестр заявок:
  `apps/crm-frontend/tmp/audit/2026-08-07/04-current-list.jpg`;
- локальные задачи:
  `apps/crm-frontend/tmp/audit/2026-08-07/05-current-tasks.jpg`;
- локальные отчёты:
  `apps/crm-frontend/tmp/audit/2026-08-07/06-current-reports.jpg`.

Снимки `02`–`06` используют синтетические fixture-данные. Они доказывают
поведение и геометрию текущего кода, но не наличие, полноту или корректность
production-данных.

### 2.2. Что не проверено

Публичный домен проверен только до доступного без учётных данных экрана входа.
Авторизованные публичные CRM-экраны, production-ассоциации специалистов и
полнота перенесённой БД этим аудитом не подтверждены. Их нельзя считать
пройденными без отдельного role-based входа и сверки API/БД после деплоя.

## 3. Hostile audit исходного frontend

Проверка строилась как атака на рабочий сценарий: что произойдёт при большом
числе записей, длинных значениях, возврате по ссылке, клавиатурной навигации,
мобильном viewport, ошибке API, недостаточном праве и конкурирующем изменении.

| Severity | Находка | Наблюдаемое доказательство | Риск для пользователя | Критерий закрытия |
|---|---|---|---|---|
| `P0` | Kanban раздвигает весь документ | при `window.innerWidth=1280` ширина `documentElement.scrollWidth=2340`; `.crm-main=1007`, `.crm-kanban=899` | навигация и рабочая область съезжают, появляется пустое пространство и глобальный горизонтальный scroll | ширина документа не превышает viewport; горизонтальный scroll локализован внутри доски |
| `P0` | Modal терял устойчивый focus lifecycle | effect зависел от меняющегося inline `onClose`; ввод мог запускать cleanup/restore, вложенный `Escape` — закрывать два слоя | потеря фокуса, непредсказуемое закрытие, блокировка клавиатурного сценария | один topmost overlay обрабатывает `Escape`; focus trap стабилен; фокус возвращается точному trigger |
| `P1` | Dashboard слишком разрежен | `02-current-dashboard.jpg`: метрики не превращены в очередь решений, мало drill-down | специалист вынужден обходить разделы вручную | блоки «требует решения», «просрочено», «ближайшие задачи» используют реальный scope и ведут к отфильтрованным данным |
| `P1` | Отчёты были только списком запусков | `06-current-reports.jpg`: нет каталога, builder, preview, результата и provenance | требование о семи группах отчётов фактически не покрыто | каталог → параметры → preview → confirm → server receipt → detail; result показывается без выдуманных графиков |
| `P1` | Задачи были только плоским списком | `05-current-tasks.jpg`: сырые UUID, нет inspector и альтернативного представления | невозможно быстро понять связь с заявкой и ответственность | list/Kanban показывают один набор; есть detail inspector и понятные ссылки; неизвестные переходы не мутируют backend |
| `P1` | «Поиск» был только локальным переходом | shell обещал поиск по CRM, но фильтровал пункты меню | ложное ожидание и потеря доверия | поверхность названа «Быстрый переход», имеет combobox keyboard contract и не заявляет глобальный поиск |
| `P1` | AI выглядел рабочим без AI API | локальный draft создавал впечатление серверного помощника | пользователь может принять фиктивный результат за сохранённое действие | AI явно помечен недоступным до появления versioned API; нет кнопки, имитирующей выполнение |
| `P1` | Cursor endpoints визуально обрезались | activities, notifications, report runs, own sessions и часть реестров показывали только первую выборку | данные «исчезают» после лимита, суперпользователь не видит всё | общий cursor paginator, явный номер локальной страницы, next/previous, error/empty/end states |
| `P1` | Фильтры не восстанавливались | значения жили только в component state; не было единого reset/debounce | reload/back/deep link теряют рабочий контекст | фильтры и режим представления кодируются в URL; text search debounce; reset возвращает нормативное состояние |
| `P1` | Таблицы на мобильном оставались широкими | responsive сводился к горизонтальному scroll | строки и действия трудно сопоставить, возможны ошибочные нажатия | строки становятся именованными карточками; action остаётся рядом с соответствующей записью |
| `P1` | DnD либо отсутствовал, либо мог бы стать скрытой мутацией | в исходном CRM не было полноценного pointer DnD и единой preview-границы | быстрый drag способен обойти required fields/version/reason | drag только создаёт `requestMove`; переход выполняется через серверную validation/preview/confirm команду; остаётся keyboard-альтернатива |
| `P2` | Навигация и состояния были неполными | вторичные маршруты трудно обнаружить; notification dot не был связан с подтверждённым unread count | лишние переходы и ложные индикаторы | route groups, доступные secondary routes, честные индикаторы, focus на `h1` после перехода |
| `P2` | Motion не имел единого назначения | движения не связывали trigger, изменившуюся область и итог | анимация не помогает понять результат действия | короткие motion tokens только для навигации/overlay/feedback; `prefers-reduced-motion` сохраняет порядок состояний |

## 4. PDF v5 — визуальный baseline, а не доказательство runtime

Базовый reference:

- `output/pdf/kurs-na-sever-crm-complete-interfaces-v5.pdf` — 52 страницы;
- `docs/design/crm-complete-interface-pack-v5/SCREEN-INVENTORY.md` — 51
  интерфейсный экран.

Для аудита сопоставлялись, в частности, dashboard, задачи, отчёты, воронки,
AI-состояния, service states, report preview и login. PDF задаёт информационную
иерархию и ожидаемое покрытие сценариев, но не доказывает API-вызов, сохранение,
роль, pagination, focus management или корректность production-данных.

Правило приёмки: для каждого runtime-сценария нужен одинаковый viewport и
состояние reference/реализации плюс API/RBAC/persisted evidence. Наличие записи
в 51-screen inventory не означает, что маршрут уже реализован.

## 5. Что безопасно адаптируется из отдельного Tracker

Источник наблюдений — отдельный Git root
`/Volumes/KINGSTON/Coding/ks_projects_tracker`. Он использован только как
interaction/reference-контур. Его доменная модель, данные, маршруты, runtime,
названия сущностей и визуальный бренд не переносятся в CRM.

| Паттерн Tracker | Адаптация в CRM | Жёсткая граница |
|---|---|---|
| Registry-first: component → contract → snippet → recipe | повторно используемые Modal, FilterBar, CursorPagination и Kanban request boundary регистрируются вместе с контрактом и тестом | registry Tracker не импортируется; CRM поддерживает собственные IDs и implementation paths |
| Recoverable navigation/state | фильтры, выбранный режим и объект восстанавливаются из URL; back/forward не уничтожают контекст | не копируются Tracker routes и hierarchy |
| Accessible overlay | named dialog, deterministic initial focus, focus trap, topmost `Escape`, invoker restore | CRM использует собственный shell и permission gates |
| Motion tokens | короткие переходы объясняют открытие панели, смену состояния и результат; reduced motion сохраняет порядок | motion не маскирует loading и не создаёт фиктивную «успешность» |
| Proposal → impact preview → human confirmation → execution → receipt | case DnD, отчёт и будущая AI-команда проходят одну явную границу подтверждения | preview не считается mutation; receipt должен прийти от CRM backend |
| `requestMove` вместо скрытой записи | drag/drop формирует запрос на переход и открывает существующий preview | без backend state machine никакого optimistic task move |

Важное ограничение: в текущем Tracker нет настоящего runtime DnD задач. Поиск
`draggable`/`onDragStart`/`onDrop` не показал рабочей Kanban-мутации; в registry
есть только контракт `requestMove`. Поэтому Tracker не является доказательством
готового drag/drop. В CRM pointer DnD проектируется как progressive enhancement
над собственной серверной transition-командой и обязательной keyboard-
альтернативой.

Наблюдаемые reference-точки Tracker:

- `registry/contracts/task-card.contract.json` — `requestMove` без скрытой
  мутации;
- `registry/contracts/tool-proposal.contract.json` и
  `registry/contracts/operation-receipt.contract.json` — human gate и receipt;
- `docs/product/GRAPH-AI-BOUNDARY.md` — proposal/preview/confirm boundary;
- `src/components/ProductUI.jsx` — dialog/focus pattern;
- `src/design/tokens.css` и `src/styles.css` — motion tokens и reduced motion;
- `src/App.jsx` — recoverable history state.

## 6. Backend и RBAC: что frontend имеет право обещать

### 6.1. Поддерживаемые контракты

- Воронки разделены стабильными кодами `relocation` и `student`. Один смешанный
  «общий» Kanban не является корректной заменой двум независимым воронкам.
- Cursor pagination предусмотрена для заявок, людей, задач, работодателей,
  направлений, запусков отчётов и административных коллекций. Frontend не должен
  «дозагружать всё» и смешивать несколько cursor pages в неограниченный DOM.
- Cases поддерживают фильтры funnel/version/stage/status/person/owner/search.
- Отчёты поддерживают list/build/get. Результат имеет общий объектный контракт,
  поэтому разрешён честный generic inspector, но не выдуманные диаграммы,
  формулы или drill-down.
- Переход case имеет серверный contract. Frontend DnD может только запросить эту
  команду после preview; он не является новым способом обойти state machine.

### 6.2. Ограничения прав и отсутствующие возможности

- `crm.report.build` определяется effective permission, а не текстом
  `businessRole`. Текущий нормативный каталог включает `platform_superadmin` и
  повышенные CRM-роли (`crm_lead_specialist`, `crm_admin`,
  `crm_department_head`), но не базовый `crm_project_manager`. Mock fixture не
  является источником RBAC-истины; расхождение должно ловиться role tests.
- `platform_superadmin` имеет all-scope чтение CRM и построение отчётов, но не
  наследует case transition/reopen, task manage или communication write.
- У task API нет опубликованного runtime transition graph. Поэтому task Kanban
  до появления контракта остаётся read-only представлением; drag/drop там был бы
  небезопасной выдумкой frontend.
- У CRM нет опубликованного AI API. Панель может показать только состояние
  «интеграция недоступна» и требуемый lifecycle, но не генерировать локальный
  «результат» от имени сервера.
- Funnel API позволяет читать определения, но не даёт frontend права изобретать
  create/update funnel.
- Для двух базовых ролей нет готового frontend/OpenAPI export-сценария. Кнопка
  CSV не показывается до появления операции и явного `crm.report.export`.
- Нет единого backend endpoint глобального CRM-поиска. Shell предоставляет
  быстрый переход по разрешённым маршрутам, а не поиск по данным.

## 7. Архитектурное решение переработки

### 7.1. Shell и навигация

- навигация делится на «Работа», «Справочники» и «Управление»;
- route availability строится по effective permissions;
- быстрый переход имеет combobox-контракт и клавиатурную навигацию;
- после route change фокус переходит на `h1`;
- мобильная навигация блокирует фон, закрывается одним `Escape` и возвращает
  фокус trigger;
- AI surface показывает честный contract status вместо локальной имитации.

### 7.2. Реестры, фильтры и pagination

- каждый endpoint сохраняет cursor отдельно от фильтров;
- UI хранит цепочку уже полученных cursor pages, чтобы дать безопасные
  «Назад/Далее» без offset-иллюзии;
- новая фильтрация сбрасывает cursor chain;
- URL является источником восстанавливаемого view/filter state;
- таблица на узком экране преобразуется в карточки через доступные `data-label`;
- loading, empty, error, denied и end-of-list — разные состояния.

### 7.3. Воронки и DnD

- `relocation` и `student` — два отдельных route-сценария с собственными
  определениями стадий и фильтрами;
- pointer DnD не меняет локальное состояние оптимистично;
- drop вызывает тот же `requestMove`, что keyboard/select-альтернатива;
- пользователь видит target stage, required reason и последствия;
- только подтверждённая backend transition обновляет карточку и создаёт receipt.

### 7.4. Задачи и отчёты

- задачи получают list/Kanban toggle, URL-фильтры и master-detail inspector;
- task Kanban read-only, пока backend не публикует transition graph;
- отчёты получают семь зарегистрированных групп, builder, preview/confirm,
  историю cursor pages, detail, freshness/provenance и generic result inspector;
- export, AI-summary и диаграммы не появляются без отдельных контрактов.

### 7.5. Dashboard

Dashboard собирает ограниченные role-scoped выборки и превращает метрики в
очередь решений. Он не загружает всю БД и не считает client-side глобальные
итоги по одной странице. Карточки ведут к соответствующим URL-фильтрам.

## 8. Матрица реализации и приёмки

Статус `проверено локально` означает, что изменение прошло общий frontend gate и
визуальную проверку в in-app browser на синтетическом API fixture. Это не
заменяет deploy proof и публичный вход под обеими ролями.

| Контур | Исходное состояние | Решение | Статус на момент документа | Обязательное доказательство приёмки |
|---|---|---|---|---|
| Shell/nav | плоская навигация, ложный search/AI | группы, quick nav combobox, честный AI status, focus lifecycle | проверено локально | keyboard test + screenshot desktop/mobile + role route matrix |
| Modal/overlay | нестабильный focus trap, nested Escape | stable callbacks, topmost stack, exact invoker restore | проверено локально | unit interaction test: typing/Tab/Shift+Tab/Escape/nested modal |
| Layout | document width 2340 при viewport 1280 | `min-width:0`, локальный board scroll, responsive containment | проверено локально | для каждого core route `document.scrollWidth <= viewport`; board scroll только внутри board |
| Relocation cases | смешанные/неполные filters | `funnelCode=relocation`, URL filters, cursor pages | проверено локально | API query test + next/back/end/error + screenshot list/Kanban |
| Student cases | не было самостоятельного рабочего route | `funnelCode=student`, собственные stages/copy | проверено локально | API query содержит `student`; данные не смешиваются с relocation |
| Case DnD | отсутствовал | pointer drag → requestMove → preview → server transition | проверено локально | test подтверждает отсутствие mutation до confirm; keyboard parity |
| Dashboard | sparse metrics | role-scoped decision queues и drill-down | проверено локально | API scope test; empty/error; ссылки сохраняют фильтры |
| Tasks | list-only, raw IDs | URL filters, list/read-only Kanban, inspector, linked case | проверено локально | один dataset в двух views; no mutation; cursor and detail tests |
| Reports | run list only | каталог семи групп, builder, preview/confirm, receipt/detail/provenance | проверено локально | Build/List/Get tests, permission negative, stale/failed/empty/denied states |
| People/employers/notifications/admin collections | первая выборка без полноценного возврата | общий cursor paginator и URL filters | проверено локально | endpoint-specific next/back/filter reset и role negative tests |
| Mobile tables | широкий table scroll | adaptive labelled cards | проверено структурно и поведением | narrow viewport screenshot; строка и action не теряют связь |
| Motion | несистемные/незаметные transitions | shell/overlay/feedback tokens + reduced motion | проверено локально | visual test normal/reduced; без изменения state order |
| Public deployment | авторизованные экраны не доказаны | exact-SHA deploy и post-deploy role/data check | не выполнено этим аудитом | deployed SHA, health, public asset/route, SA/SP login, API/DB association evidence |

### 8.1. Локальные доказательства F1–F3

- `npm run verify`: registry `15` components / `51` screens / `7` recipes /
  `120` OpenAPI operation IDs; lint и typecheck без ошибок; `16` test files и
  `60` tests passed; production build и `4` hosting tests passed;
- core routes `dashboard`, `relocation`, `students`, `tasks?view=list`,
  `tasks?view=kanban` и `reports` измерены при viewport `1280 px`: ширина
  документа на каждом маршруте `1265 px`, то есть глобального horizontal scroll
  нет;
- Kanban: client width `902 px`, scroll width `2056 px`; горизонтальная
  прокрутка локализована внутри доски;
- keyboard quick navigation открыла `/cabinet/crm/tasks`; case stage select
  открыл draft-modal без backend mutation; report lifecycle дошёл до серверной
  fixture-квитанции `RPT-700`;
- in-app browser имеет фиксированный viewport, поэтому mobile acceptance
  подтверждена структурно (`data-label` cells, card media query, mobile overlay
  inert/focus/Escape test), но отдельный narrow-viewport screenshot остаётся
  частью публичной/ручной приёмки.

## 9. Ворота готовности

### Gate F1 — contracts and static quality

- OpenAPI types синхронизированы;
- registry components/contracts/snippets/recipes проходят validator;
- typecheck, lint и production build завершаются без ошибок;
- нет новых локальных доменных типов, противоречащих OpenAPI.

### Gate F2 — behavior

- cursor next/back/filter reset проверены на каждом подключённом реестре;
- relocation/student действительно посылают разные funnel codes;
- case DnD не выполняет mutation до confirm;
- task Kanban не предлагает запрещённый переход;
- modal/focus/keyboard сценарии воспроизводимы;
- permission negative tests не только скрывают кнопку, но и подтверждают API
  `403`.

### Gate F3 — visual and responsive

- desktop core routes не расширяют документ за viewport;
- Kanban имеет только локальный horizontal scroll;
- mobile tables превращаются в карточки;
- loading/empty/error/denied/stale/conflict состояния визуально различимы;
- reference и реализация сравниваются в одинаковых данных и viewport.

### Gate F4 — release and production truth

- commit и image/artifact связаны одним SHA;
- public route отдаёт новый bundle;
- суперпользователь видит all-scope данные, но запрещённые writes возвращают
  `403`;
- специалист видит assigned scope и сохранённые employee associations;
- cursor проходит дальше первой страницы production-данных;
- DB counts и ассоциации сверены отдельным read-only reconciliation;
- отсутствие авторизованной публичной проверки фиксируется как blocker, а не
  заменяется локальным screenshot.

## 10. Residual risks и сознательные ограничения

- PDF v5 и локальные screenshots не подтверждают production DB.
- Работающий frontend не исправляет отсутствующий backend transition/AI/export
  contract.
- `businessRole` нельзя использовать вместо effective permissions.
- Суперпользователь «видит всё» в разрешённом read scope, но не превращается в
  специалиста для бизнес-мутаций.
- Pointer DnD не должен быть единственным способом перехода; клавиатурный
  сценарий обязателен.
- Нельзя копировать незавершённый или dirty runtime Tracker в CRM. Адаптируются
  только проверяемые interaction-принципы через собственные CRM-контракты.
- До role-based post-deploy проверки нельзя заявлять, что публичный CRM полностью
  готов или что старая БД и все связи специалистов видимы в production.

## 11. Итоговый критерий

Переработка принимается только тогда, когда специалист и суперпользователь
завершают свои основные сценарии без скрытых ID, потери фильтра, обрезанной
выборки, глобального horizontal scroll и фиктивных возможностей, а каждое
критичное действие подтверждается API/RBAC/persisted evidence. Визуальное
соответствие PDF обязательно, но является одной частью доказательства, а не
заменой работающей системы.
