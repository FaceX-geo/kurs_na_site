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
| API | `/api/v1` |

## Development and Deployment

For a local preview, Docker Compose builds the same Nginx image used in the
deployment:

```bash
cp .env.example .env.local
docker compose up --build web
```

The managed staging deployment is:

```text
https://cursnasever.facex.pro
```

Pushes to `main` run the checked-in GitHub Actions workflow. It validates the
static source, transfers a clean Git archive to Charlie, builds a local image
there, and updates the `kurs-na-site` Swarm stack. Do not use a remote Docker
context or manually publish a container to another server.

The first stack creation remains an explicit `infra-as-code` operation; routine
updates are owned by this repository's GitHub Actions workflow.

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
│   └── app-swarm-deploy.yml   # GitHub Actions deploy to Charlie
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

- работает с `baseUrl="/api/v1"`;
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

Используется очень простой конфиг:

- корень: `/usr/share/nginx/html`;
- входная страница: `index.html`;
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
