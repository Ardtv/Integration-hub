# Архитектура интеграции amoCRM → Integration Hub → БД

## Общая схема
┌─────────┐ webhook ┌──────────────┐ POST /api/events ┌───────┐ worker ┌────────────┐
│ amoCRM │ ─────────▶ │amo-connector │ ─────────────────▶ │ Hub │ ───────▶ │ PostgreSQL │
└─────────┘ │ :3002 │ X-Api-Token │ :3001 │ │instinct_db │
└──────────────┘ └───────┘ └────────────┘


## Компоненты

### amo-connector (порт 3002)
**Файл:** `connectors/amo/webhook-server.js`

**Задачи:**
- Принимает вебхуки от amoCRM на `POST /webhook/amo`
- Проверяет `X-Webhook-Secret`
- Извлекает данные заказа (`extractOrder`)
- Определяет тип события (`detectEvents`)
- Отправляет в hub с `X-Api-Token`
- Retry 3 раза при недоступности hub

**Обрабатываемые события:**
| amoCRM | Hub eventType |
|--------|---------------|
| `leads.add` | `deal.created` |
| `leads.update` | `deal.updated` |
| `leads.status` | `deal.status_updated` |

### Hub (порт 3001)
**Файл:** `src/index.ts`

**Компоненты:**
- **API** (`src/api/events.controller.ts`) — принимает `POST /api/events`
- **Очередь** (`src/repositories/queue.repository.ts`) — `integration_queue`
- **Worker** (`src/queue/worker.ts`) — обрабатывает события
- **Event Handler** (`src/services/event-handler.service.ts`) — маршрутизация
- **Order Service** (`src/services/order.service.ts`) — бизнес-логика

**Endpoints:**
- `POST /api/events` — приём событий
- `GET /api/stats` — статистика
- `GET /api/events` — pending events
- `GET /api/dead` — dead-letter queue
- `GET /health` — healthcheck

### PostgreSQL (instinct_db)
**Основные таблицы:**

| Таблица | Назначение |
|---------|-----------|
| `orders` | Заказы |
| `users` | Клиенты (уникальны по телефону) |
| `integration_queue` | Очередь событий |
| `external_id_mapping` | Связи `amoCRM ID ↔ orders.id` |
| `integration_logs` | Логи операций |

## Поток данных

1. **amoCRM** шлёт вебхук → `POST /webhook/amo`
2. **amo-connector**:
   - Проверяет `X-Webhook-Secret`
   - `detectEvents()` — определяет тип
   - `extractOrder()` — извлекает данные
   - `HubClient.sendWithRetry()` — отправляет в hub
3. **Hub**:
   - `POST /api/events` — принимает, кладёт в `integration_queue`
4. **Worker** (каждые 5 сек):
   - `getPending()` — берёт события
   - `eventHandler.handle()` — обрабатывает
   - `markProcessed()` / `markFailed()` / `markDead()`
5. **OrderService**:
   - `findByExternalId()` — ищет заказ
   - `create()` / `update()` — создаёт/обновляет
   - `external_id_mapping` — сохраняет связь

## Обработка ошибок

| Ситуация | Действие |
|----------|----------|
| Вебхук без секрета | 401 |
| Невалидный payload | 400 |
| Hub недоступен | Retry 3 раза (2, 4 сек) → 502 |
| Ошибка обработки | `markFailed` → retry до 3 раз |
| 3 неудачи | `markDead` → в `/api/dead` |
| Дубликат `operation_key` | `duplicate`, не создаётся |

## Идемпотентность

- **Уровень 1:** `operation_key` UNIQUE в `integration_queue`
- **Уровень 2:** `external_id_mapping` — `amoCRM ID ↔ orders.id`

Повторный вебхук:
- С тем же `operation_key` → `duplicate`
- С другим `operation_key`, но тем же `external_id` → `update` (не дубль)

## Переменные окружения

| Переменная | Где | Назначение |
|------------|-----|-----------|
| `AMO_WEBHOOK_PORT` | amo-connector | Порт (3002) |
| `HUB_URL` | amo-connector | URL hub |
| `HUB_API_TOKEN` | amo-connector + hub | Токен авторизации |
| `AMO_WEBHOOK_SECRET` | amo-connector | Секрет вебхука |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | hub | Подключение к БД |
| `HUB_PORT` | hub | Порт (3001) |

## IIKO — интеграция

### Статус

| Компонент | Статус |
|-----------|--------|
| API-клиент (`iiko-client.js`) | ✅ Готов |
| Авторизация v2 (apiKey+appId+clientSecret) | ✅ Работает |
| Синхронизация меню (`sync-menu.js`) | ✅ Готов (ждёт меню) |
| Отправка заказов (`send-order.js`) | ✅ Готов (ждёт меню) |
| Синхронизация статусов (`sync-status.js`) | ✅ Готов (ждёт заказы) |
| Cron-расписание | ✅ Настроено |
| `handleIiko` в хабе | ✅ Готов |

### Компоненты

| Файл | Назначение |
|------|-----------|
| `connectors/iiko/iiko-client.js` | API-клиент (8 методов) |
| `connectors/iiko/sync-menu.js` | Синхронизация меню → `products` (cron: каждые 15 мин) |
| `connectors/iiko/send-order.js` | Отправка заказов в IIKO |
| `connectors/iiko/sync-status.js` | Синхронизация статусов (cron: каждые 5 мин) |
| `connectors/iiko/test-connection.js` | Тест подключения |
| `connectors/iiko/README.md` | Документация |

### Методы `iiko-client.js`

- `getToken()` — авторизация
- `getOrganizations()` — список организаций
- `getTerminalGroups(orgId)` — терминалы
- `getNomenclature(orgId)` — меню
- `getStopList(orgId)` — стоп-лист
- `createDeliveryOrder(orgId, terminalGroupId, order)` — создать заказ
- `getOrderById(orgId, orderId)` — статус заказа
- `getOrdersByDate(orgId, from, to)` — заказы за период
- `getStockBalance(orgId)` — остатки (401, не доступно)

### Cron
15 * * * * — sync-menu.js
5 * * * * — sync-status.js

### Переменные

```env
IIKO_API_BASE=https://api-ru.iiko.services
IIKO_API_KEY=...
IIKO_APP_ID=...
IIKO_CLIENT_SECRET=...
IIKO_ORGANIZATION_ID=084cf002-ef41-4d35-88e5-8026413c05eb
IIKO_TERMINAL_GROUP_ID=1f887843-83ee-71f9-019d-44005e1d0066
###Организация

    Название: Elite fungi

    ID: 084cf002-ef41-4d35-88e5-8026413c05eb

    Терминал: 1f887843-83ee-71f9-019d-44005e1d0066

    posVersion: 9.4.8049.0

###Ограничения

    Меню — пусто (ждём заказчика)

    Склад (/api/1/stock/balance) — 401, ограничение тарифа

###События в хабе

    iiko.order.created

    iiko.order.status_updated

    iiko.order.cancelled

    iiko.stop_list.updated

    iiko.menu.synced
###Поток данных
amoCRM/Hub → send-order.js → IIKO API (createDeliveryOrder)
IIKO API → sync-status.js → orders (обновление статуса)
IIKO API → sync-menu.js → products (синхронизация меню)

### Авторизация v2
Три параметра:
- `apiKey` — iikoWeb → **Integrations → API Keys**
- `appId` — UUID из https://public-api.iikoweb.ru/portal
- `clientSecret` — оттуда же (показывается один раз)

**Endpoint:** `POST /api/v2/access_token`

**Токен:** живёт 1 час, refresh token нет.

### Что дальше
После получения доступов и ТЗ — реализация вебхуков и/или синхронизации.

**Что уже есть:**
- `connectors/iiko/iiko-client.js` — API-клиент (token, organizations)
- `connectors/iiko/test-connection.js` — тест подключения
- `connectors/iiko/README.md` — документация
- `scripts/test-iiko.sh` — скрипт запуска
- `case 'iiko'` в `event-handler.service.ts` — заглушка

**Планируется (после ТЗ):**
- вебхуки IIKO — если заказчик подтвердит push-модель
- `poller.js` — если нужен опрос API
