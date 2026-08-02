# Bravo Remote Docker

В этом проекте исходный код редактируется на macOS, а весь Docker runtime
работает только на удалённом сервере Bravo.

## Зафиксированный контур

| Параметр | Значение |
|---|---|
| Docker Context | `remote-build` |
| Docker endpoint | `ssh://bravo-108` |
| Bravo LAN address | `192.168.0.108` |
| Compose service | `web` |
| Development URL | `http://192.168.0.108:8105/` |

Контекст и SSH-конфигурация управляются вне репозитория. Скрипты проекта их
не переключают и не изменяют.

## Единственная точка входа

Все Compose-команды запускаются через:

```bash
./scripts/bravo-compose.sh <compose arguments>
```

Скрипт:

- всегда передаёт `--context remote-build`;
- проверяет endpoint `ssh://bravo-108`;
- отказывается работать с `default` и `desktop-linux`;
- не меняет глобально выбранный Docker Context;
- поддерживает и Docker CLI plugin, и standalone `docker-compose`;
- использует изолированный несекретный client config без зависимости от Docker Desktop;
- блокирует `down -v` и `rm -v`.

Для работы wrapper нужны только клиентские плагины Compose и Buildx. На macOS
они могут быть установлены через Homebrew; установка CLI не запускает локальный
Docker Engine:

```bash
brew install docker-compose docker-buildx
```

## Стандартный цикл разработки

```bash
./scripts/bravo-compose.sh config
./scripts/bravo-compose.sh build web
./scripts/bravo-compose.sh up -d web
./scripts/bravo-compose.sh ps
./scripts/bravo-compose.sh logs --tail=120 web
```

Проверка HTTP и health выполняется через Bravo:

```bash
curl --fail --show-error --silent http://192.168.0.108:8105/ >/dev/null
./scripts/bravo-compose.sh ps
```

После значимых UI-изменений страницу нужно открыть по Bravo URL в браузере,
проверить desktop/mobile состояния и сохранить контрольные скриншоты.

## Запрещённые сценарии

Не запускать в этом репозитории:

```bash
docker compose up
docker --context default compose up
docker --context desktop-linux compose up
docker system prune
docker volume prune
docker compose down -v
```

Операции очистки, изменение Docker Context, SSH-конфигурации и инфраструктуры
Bravo выполняются только по отдельному явному поручению.
