# Integration Hub

Центральный сервис для приёма событий от внешних систем (amoCRM) и превращения их в заказы в базе данных.

## Содержание

- [Архитектура](#архитектура)
- [Компоненты](#компоненты)
- [Поток данных](#поток-данных)
- [Быстрый старт](#быстрый-старт)
- [Переменные окружения](#переменные-окружения)
- [Endpoints](#endpoints)
- [Скрипты](#скрипты)
- [Структура проекта](#структура-проекта)
- [Тестирование](#тестирование)
- [Разработка](#разработка)

## Архитектура

```
┌─────────┐  webhook   ┌──────────────┐  POST /api/events  ┌───────┐  worker  ┌────────────┐
│ amoCRM  │ ─────────▶ │amo-connector │ ─────────────────▶ │  Hub  │ ───────▶ │ PostgreSQL │
└─────────┘            │   :3002      │   X-Api-Token      │ :3001 │          │instinct_db │
                       └──────────────┘                    └───────┘          └────────────┘
```

## Компоненты

### Hub (`src/`, порт 3001)

Центральный сервис: приём событий, очередь, worker, обработка.

- **API** (`src/api/events.controller.ts`) — приём событий через `POST /api/events`
- **Очередь** (`src/repositories/queue.repository.ts`) — таблица `integration_queue`
- **Worker** (`src/queue/worker.ts`) — фоновый обработчик, поллинг каждые 5 сек
- **Event Handler** (`src/services/event-handler.service.ts`) — маршрутизация по типу события
- **Order Service** (`src/services/order.service.ts`) — бизнес-логика заказов
- **Logger** (`src/config/logger.ts`) — pino, JSON-формат

### amo-connector (`connectors/amo/`, порт 3002)

Принимает вебхуки от amoCRM, извлекает данные, отправляет в Hub.

- `webhook-server.js` — приём вебхуков и отправка
- `parsers/deal-parser.js` — парсинг сделки
- `amo-client.js` — клиент для API amoCRM
- `../shared/hub-client.js` — клиент Hub с retry

### PostgreSQL (`instinct_db`)

| Таблица | Назначение |
|---------|-----------|
| `orders` | Заказы |
| `users` | Клиенты (уникальны по телефону) |
| `external_order_items` | Товары из amoCRM |
| `integration_queue` | Очередь событий |
| `external_id_mapping` | Связи `amoCRM ID ↔ orders.id` |
| `integration_logs` | Логи операций |

## Поток данных

1. **amoCRM** шлёт вебхук → `POST /webhook/amo` в `amo-connector`
2. **amo-connector**:
   - проверяет `X-Webhook-Secret`
   - `detectEvents()` — определяет тип события
   - `extractOrder()` — извлекает данные (имя, телефон, email, сумма, товары)
   - `HubClient.sendWithRetry()` — отправляет в Hub с `X-Api-Token`
3. **Hub**:
   - `POST /api/events` — принимает, кладёт в `integration_queue`, отвечает `200 OK`
4. **Worker** (каждые 5 сек):
   - `getPending()` — берёт события
   - `eventHandler.handle()` — обрабатывает
   - `markProcessed()` / `markFailed()` / `markDead()`
5. **OrderService**:
   - `findByExternalId()` — ищет заказ по внешнему ID
   - `create()` / `update()` — создаёт или обновляет
   - `external_id_mapping` — сохраняет связь
   - `external_order_items` — сохраняет товары

## Обрабатываемые события

| amoCRM | Hub eventType | Действие |
|--------|---------------|----------|
| `leads.add` | `deal.created` | Создать заказ |
| `leads.update` | `deal.updated` | Обновить заказ |
| `leads.status` | `deal.status_updated` | Сменить статус |
| `leads.delete` | `deal.deleted` | Пометить `cancelled` |

## Маппинг статусов

| `status_id` amoCRM | `orders.status` |
|---|---|
| 142 | `new` |
| 143 | `pending_payment` |
| 144 | `paid` |
| 145 | `cancelled` |
| (другой) | `new` |

## Ключевые принципы

### Асинхронность
Hub сразу отвечает `200 OK`, обработка в фоне. События не теряются при перезапуске.

### Идемпотентность
- **`operation_key`** — UNIQUE, повторный вебхук → `duplicate`
- **`external_id_mapping`** — связь `amoCRM ID ↔ orders.id`, повторный → `update`

### Retry
- **amo-connector → Hub:** 3 попытки с задержкой 2 и 4 сек
- **Hub worker:** retry до 3 раз при ошибке
- После 3 ошибок → мёртвая очередь (`dead`)

### Безопасность
- **amoCRM → amo-connector:** `X-Webhook-Secret`
- **amo-connector → Hub:** `X-Api-Token`

### Защита данных при обновлении
Для `deal.updated` заглушки (`Unknown`, `unknown_<id>`) **не подставляются** — `update()` пропускает `null`, существующие данные не затираются.

## Быстрый старт

### 1. Клонировать

```bash
git clone https://github.com/Ardtv/Integration-hub.git
cd Integration-hub
```

### 2. Установить зависимости

```bash
npm install
```

### 3. Настроить окружение

```bash
cp .env.example .env
nano .env
```

Заполнить: `HUB_API_TOKEN`, `AMO_WEBHOOK_SECRET`, `DB_PASSWORD`.

### 4. Собрать

```bash
npm run build
```

### 5. Создать таблицы в БД

```bash
sudo -u postgres psql -d instinct_db -f migrations/001_integration_tables.sql
```

### 6. Запустить

```bash
pm2 start ecosystem.config.js
pm2 save
```

### 7. Проверить

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## Переменные окружения

| Переменная | Где | Назначение | Пример |
|------------|-----|-----------|--------|
| `HUB_PORT` | Hub | Порт | `3001` |
| `HUB_API_TOKEN` | Hub + amo-connector | Токен авторизации | hex-32 |
| `AMO_WEBHOOK_PORT` | amo-connector | Порт | `3002` |
| `HUB_URL` | amo-connector | URL Hub | `http://localhost:3001` |
| `AMO_WEBHOOK_SECRET` | amo-connector | Секрет вебхука | hex-32 |
| `DB_HOST` | Hub | Хост БД | `localhost` |
| `DB_PORT` | Hub | Порт БД | `5432` |
| `DB_NAME` | Hub | Имя БД | `instinct_db` |
| `DB_USER` | Hub | Пользователь БД | `instinct_user` |
| `DB_PASSWORD` | Hub | Пароль БД | — |
| `LOG_LEVEL` | Hub | Уровень логов | `info` |
| `NODE_ENV` | Hub | Окружение | `production` |

## Endpoints

### Hub (:3001)

| URL | Метод | Auth | Назначение |
|-----|-------|------|-----------|
| `/health` | GET | — | Healthcheck |
| `/api/events` | POST | `X-Api-Token` | Приём событий |
| `/api/stats` | GET | `X-Api-Token` | Статистика |
| `/api/events` | GET | `X-Api-Token` | Pending события |
| `/api/dead` | GET | `X-Api-Token` | Мёртвая очередь |

### amo-connector (:3002)

| URL | Метод | Auth | Назначение |
|-----|-------|------|-----------|
| `/health` | GET | — | Healthcheck |
| `/webhook/amo` | POST | `X-Webhook-Secret` | Приём вебхуков |

## Скрипты

| Скрипт | Время | Что делает |
|--------|-------|-----------|
| `scripts/healthcheck.sh` | 10 сек | Состояние всех сервисов |
| `scripts/demo.sh` | 15 сек | Демо: создание + оплата |
| `scripts/e2e-full.sh` | 40 сек | E2E: 5 сценариев |

### healthcheck.sh

```bash
~/integration-hub/scripts/healthcheck.sh
```

Проверяет Hub, amo-connector, БД, очередь, последние ошибки и заказы.

### demo.sh

```bash
~/integration-hub/scripts/demo.sh
```

Создаёт сделку → заказ в БД → меняет статус на `paid`.

### e2e-full.sh

```bash
~/integration-hub/scripts/e2e-full.sh
```

5 сценариев:
1. Создание заказа
2. Обновление цены
3. Смена статуса
4. Без телефона (fallback)
5. Retry при недоступности Hub

## Структура проекта

```
integration-hub/
├── src/                          # Hub (Node.js + TypeScript)
│   ├── api/
│   │   └── events.controller.ts  # Приём событий
│   ├── config/
│   │   ├── database.ts           # Подключение к PostgreSQL
│   │   └── logger.ts             # Pino logger
│   ├── queue/
│   │   └── worker.ts             # Фоновый обработчик
│   ├── repositories/
│   │   ├── order.repository.ts
│   │   ├── order-item.repository.ts
│   │   ├── queue.repository.ts
│   │   └── mapping.repository.ts
│   ├── services/
│   │   ├── order.service.ts
│   │   └── event-handler.service.ts
│   └── index.ts                  # Точка входа
├── connectors/
│   ├── amo/                      # amo-connector (Node.js)
│   │   ├── webhook-server.js
│   │   ├── amo-client.js
│   │   ├── parsers/
│   │   │   └── deal-parser.js
│   │   └── README.md
│   └── shared/
│       └── hub-client.js         # Клиент Hub с retry
├── scripts/
│   ├── healthcheck.sh
│   ├── demo.sh
│   └── e2e-full.sh
├── docs/
│   ├── ARCHITECTURE.md           # Архитектура
│   └── E2E.md                    # E2E инструкция
├── migrations/
│   └── 001_integration_tables.sql    # Схема БД
├── ecosystem.config.js           # PM2 конфиг
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Тестирование

### Healthcheck

```bash
~/integration-hub/scripts/healthcheck.sh
```

Ожидаемый вывод:
```
✅ Hub OK
✅ amo-connector OK
✅ БД OK
```

### Демо

```bash
~/integration-hub/scripts/demo.sh
```

Ожидаемый вывод:
```
▶ Шаг 3: Заказ уже в БД
 id | customer_name | customer_phone | total_amount_minor | status
----+---------------+----------------+--------------------+--------
 45 | Демо Клиент   | +79991234567   |             999900 | new

▶ Шаг 5: Статус заказа обновился
----+---------------+----------------+--------------------+--------
 45 | Демо Клиент   | +79991234567   |             999900 | paid

✅ ДЕМО ЗАВЕРШЕНО
```

### E2E

```bash
~/integration-hub/scripts/e2e-full.sh
```

Проверяет 5 сценариев, выводит итоговый отчёт.

## Разработка

### Сборка

```bash
npm run build
```

### Запуск dev (без сборки)

```bash
npm run dev
```

### Перезапуск после правок

```bash
rm -rf dist && npm run build && pm2 restart hub
```

### Логи

```bash
pm2 logs hub --lines 50
pm2 logs amo-connector --lines 50
```

### Отладка очереди

```bash
sudo -u postgres psql -d instinct_db -c "
SELECT id, event_type, status, error_message, retry_count
FROM integration_queue
ORDER BY id DESC LIMIT 10;"
```

### Сбросить упавшее событие

```bash
sudo -u postgres psql -d instinct_db -c "
UPDATE integration_queue
SET status = 'pending', retry_count = 0, error_message = NULL
WHERE id = <event_id>;"
```

## Лицензия

Proprietary. Все права защищены.
