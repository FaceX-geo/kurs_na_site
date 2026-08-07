# `kurs_na_site`

```txt
> boot sequence: arctic-career-frontend
> mode: static landing / premium UI / vanilla runtime
> stack: HTML + CSS + JS + Nginx + Docker Compose
> bundlers harmed: 0
```

Одностраничный сайт проекта «Курс на Север» для привлечения специалистов и студентов в Мурманскую область.  
Репозиторий собран как статический фронтенд без этапа сборки: интерфейс открывается сразу, а интерактивность живет в `scripts/main.js`.

## Что внутри

- премиальный `hero` с многоуровневым параллаксом, движущимся градиентом и реакцией на курсор;
- адаптивная шапка с десктопной и мобильной навигацией;
- блок «Меры поддержки» с фильтрами, карточками и модальными окнами;
- таймлайн переезда и информационные секции;
- двухшаговая форма заявки с валидацией, загрузкой файла и отправкой в REST API;
- graceful fallback для `prefers-reduced-motion` и сценария без JS.

## Стек

| Слой | Реализация |
|---|---|
| Разметка | `index.html` |
| Стили | `styles/main.css`, `styles/brand.css` |
| Поведение | `scripts/main.js`, `scripts/api-client.js` |
| Шрифты | локальные, из `assets/fonts` |
| Статика | `nginx:1.27-alpine` |
| Запуск | `docker-compose.yml` |
| API | `/public/v1` (`/api/v1` — deprecated compatibility alias) |

## Development and Deployment

Исходный код редактируется локально, но Docker Engine, BuildKit, Compose, PostgreSQL и runtime
проверки этого workspace выполняются только на Bravo через явный context `remote-build`. Локально
разрешены статические Node-проверки и backend `pnpm verify` без запуска контейнеров.

Bravo development address:

```text
http://192.168.0.108:8105/
```

Static landing и CRM backend развёртываются двумя Compose-проектами из одного immutable source
archive. Backend подключает API к существующей landing-сети `kurs_na_site_default` с alias
`crm-api`, после чего Nginx маршрутизирует `/public/v1`, `/api/v1`, `/internal/v1` и health routes до
static fallback. Production secrets хранятся только в закрытом server-side env-файле.

```bash
docker --context remote-build compose -f apps/crm-backend/compose.yaml --env-file /secure/path/crm.env up -d --build
docker --context remote-build compose -f docker-compose.yml up -d --build
```

После каждого runtime-изменения обязательны readiness, логи, HTTP smoke и визуальная проверка Bravo
URL. GitHub Actions staging на `main` является отдельным release-контуром и не заменяет Bravo
acceptance; production cutover остаётся явным операторским действием.

## Runtime Topology

```txt
.
├── index.html                 # точка входа страницы
├── styles/
│   ├── main.css               # основная токен-система, layout, motion, компоненты
│   └── brand.css              # брендовые правила / дополнительные токены
├── scripts/
│   ├── main.js                # UI runtime, motion, меню, модалки, форма
│   └── api-client.js          # REST-клиент с retry-логикой
├── assets/
│   ├── fonts/                 # self-hosted шрифты
│   └── images/                # логотипы и графика
├── docs/
│   ├── api-contract.md        # договор по API
│   ├── brand-spec.md          # визуальные правила
│   └── content-map.md         # карта переноса контента со старого сайта
├── .github/workflows/
│   └── app-swarm-deploy.yml   # отдельный GitHub Actions staging-контур
├── scripts/
│   └── facex-local-build-deploy.sh # server-local build and Swarm update
├── docker-compose.yml         # local development check
└── docker/nginx/default.conf  # конфиг nginx
```

## Архитектура без магии

Проект намеренно сделан без сборщика и без фреймворка.

Почему это полезно:

- минимальный TTFB для статической раздачи;
- нет зависимости от `node_modules` ради простого лендинга;
- проще деплой и ревью;
- любой разработчик открывает проект и сразу видит конечный HTML/CSS/JS, а не транспилированный слой поверх слоя.

## UI Runtime

Основная клиентская логика находится в [scripts/main.js](scripts/main.js):

- `initMobileMenu()` — открытие/закрытие мобильного меню, trap focus;
- `initSmoothAnchors()` — плавный скролл с учетом высоты sticky header;
- `initRevealAnimations()` — появление секций через `IntersectionObserver`;
- `initParallaxScenes()` — многоуровневый параллакс для `hero` и фоновых секций;
- `initSupportFilters()` — фильтрация карточек мер поддержки;
- `initModals()` — модальные окна с возвратом фокуса и закрытием по `Esc`;
- `initApplicationForm()` — 2-step форма, валидация, загрузка резюме, submit;
- `initYear()` — автоматическая подстановка года в футере.

## Сеть и API

Клиентский слой для API находится в [scripts/api-client.js](scripts/api-client.js).

Что он делает:

- использует canonical `baseUrl="/public/v1"`; `/api/v1` остаётся только compatibility alias;
- поддерживает `GET /dictionaries/spheres`;
- поддерживает `POST /files` для загрузки резюме;
- поддерживает `POST /applications` для отправки заявки;
- делает retry на `429`, `500`, `502`, `503`, `504`;
- поднимает унифицированный `ApiError` с `status`, `requestId`, `errors[]`.

Документированный контракт лежит в [docs/api-contract.md](docs/api-contract.md).

## Поведение формы

Форма заявки не декоративная, а интеграционная.

Под капотом:

- шаг 1: персональные данные;
- шаг 2: параметры заявки и согласие;
- проверка возраста, email и телефона;
- field-level ошибки для `422`;
- глобальное сообщение об ошибке с `requestId`;
- success message после отправки;
- fallback словаря сфер на статический список, если backend недоступен.

Важно:

- список сфер умеет жить без backend;
- сама отправка заявки без backend завершится ожидаемой ошибкой сети;
- значит, UI можно безопасно разрабатывать отдельно от сервера.

## Motion / Accessibility Contract

Проект не должен выглядеть «мертвым», но и не должен мешать читать.

Зафиксированные правила:

- контент видим по умолчанию даже при отключенном JS;
- декоративное движение режется через `prefers-reduced-motion`;
- модалки и мобильное меню управляются с клавиатуры;
- интерактивные элементы получают `focus-visible`;
- локальные шрифты не требуют CDN.

Детали лежат в [docs/brand-spec.md](docs/brand-spec.md).

## Контент и миграция

Этот репозиторий не просто «новый лендинг», а аккуратная миграция структуры старого сайта:

- исходные материалы и карта переноса описаны в [docs/content-map.md](docs/content-map.md);
- старый HTML сохранен в `old-index.html`;
- исходный архив страницы лежит в `Курс на Север.webarchive`.

## Nginx Layer

Nginx одновременно раздаёт статику и является same-origin edge для backend:

- корень: `/usr/share/nginx/html`;
- входная страница: `index.html`;
- API/identity/health routes проксируются в build-time `CRM_API_UPSTREAM` до static fallback;
- локальный Bravo build использует `crm-api:8080`, а managed edge — только явно заданный private
  upstream; значение валидируется при сборке и не может превратить Nginx-конфиг в произвольный
  фрагмент;
- `CRM_TRUSTED_EDGE_HEADERS=true` разрешён только за управляемым Nginx edge: он берёт протокол и
  client IP из перезаписанных edge-заголовков, не доверяя клиентскому `X-Forwarded-For`;
- клиентский `X-Forwarded-For` не сохраняется — edge выставляет фактический `$remote_addr`;
- fallback: `try_files $uri $uri/ /index.html;`

Это значит, что статика отдается без дополнительной логики, а корневая страница всегда под рукой.

## Dev Notes

Если вы меняете визуал:

- главный источник правды по токенам — [styles/main.css](styles/main.css);
- визуальные ограничения и тон — [docs/brand-spec.md](docs/brand-spec.md);
- смысловая карта контента — [docs/content-map.md](docs/content-map.md).

Если вы меняете интеграцию:

- сначала сверяйтесь с [docs/api-contract.md](docs/api-contract.md);
- потом меняйте [scripts/api-client.js](scripts/api-client.js) и форму в [scripts/main.js](scripts/main.js).

## TL;DR

```txt
Static frontend.
No build step.
Local fonts.
Vanilla JS.
Dockerized nginx.
REST-ready form.
Premium motion without UI entropy.
```

Если коротко: это не «просто лендинг», а чистый статический фронтенд с нормальной инженерной дисциплиной.
