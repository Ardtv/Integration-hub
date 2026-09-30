# IIKO Connector

Интеграция с IIKO Cloud API (`https://api-ru.iiko.services`).

## Статус

| Компонент | Статус |
|-----------|--------|
| API-клиент (`iiko-client.js`) | ✅ Готов |
| Авторизация v2 (apiKey+appId+clientSecret) | ✅ Работает |
| Синхронизация меню (`sync-menu.js`) | ✅ Работает |
| Отправка заказов (`send-order.js`) | ✅ Работает |
| Синхронизация статусов (`sync-status.js`) | ✅ Работает |
| Cron-расписание | ✅ Настроено |
| Тест подключения (`test-connection.js`) | ✅ Готов |

## Авторизация v2

IIKO использует **новую схему авторизации** — нужны **три параметра**:

| Параметр | Где взять | Формат |
|----------|-----------|--------|
| `apiKey` | iikoWeb → **Integrations → API Keys** | строка |
| `appId` | https://public-api.iikoweb.ru/portal | UUID |
| `clientSecret` | оттуда же (показывается **один раз**) | строка |

### Endpoint

```
POST https://api-ru.iiko.services/api/v2/access_token
```

### Запрос

```json
{
  "apiKey": "...",
  "appId": "550e8400-e29b-41d4-a716-446655440000",
  "clientSecret": "..."
}
```

### Ответ

```json
{
  "correlationId": "...",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Токен живёт 1 час. Refresh token нет.**

## Методы `iiko-client.js`

| Метод | Что делает |
|-------|-----------|
| `getToken()` | Авторизация |
| `getOrganizations()` | Список организаций |
| `getTerminalGroups(orgId)` | Терминалы |
| `getNomenclature(orgId)` | Меню |
| `getStopList(orgId)` | Стоп-лист |
| `createDeliveryOrder(orgId, terminalGroupId, order)` | Создать заказ |
| `getOrderById(orgId, orderId)` | Статус заказа |
| `getOrdersByDate(orgId, from, to)` | Заказы за период |
| `getStockBalance(orgId)` | Остатки (401, не доступно) |

## Скрипты синхронизации

| Скрипт | Расписание | Что делает |
|--------|-----------|-----------|
| `sync-menu.js` | каждые 15 мин | Меню → `external_products` |
| `sync-status.js` | каждые 5 мин | Статусы заказов → `orders` |

**Запуск вручную:**

```bash
node connectors/iiko/sync-menu.js
node connectors/iiko/sync-status.js
```

**Cron:**

```
15 * * * * cd /root/integration-hub && node connectors/iiko/sync-menu.js
5 * * * * cd /root/integration-hub && node connectors/iiko/sync-status.js
```

## Отправка заказов

**Модуль:** `send-order.js`

```javascript
const { sendOrderToIiko } = require('./send-order');
const result = await sendOrderToIiko({
    id: 123,
    customer_phone: '+79991234567',
    delivery_address: 'Москва, ул. Ленина 1',
    items: [
        { product_id: 1, quantity: 2 }
    ]
});
```

**Что делает:**
1. Маппит `product_id` → IIKO `productId` (через `external_id_mapping`)
2. Отправляет через `createDeliveryOrder()`
3. Сохраняет `iiko_order_id` в `orders`

## Тесты

```bash
# Полный тест API
~/integration-hub/scripts/test-iiko-full.sh

# Тест всех скриптов
~/integration-hub/scripts/test-iiko-scripts.sh

# Или напрямую
node connectors/iiko/test-connection.js
```

### Ожидаемый вывод (при успехе)

```
▶ Тест 1: Получение токена
✅ Токен получен

▶ Тест 2: Список организаций
✅ Организаций: 1
   - Elite fungi

▶ Тест 3: Терминальные группы
✅ Терминальных групп: 1 | Терминалов: 1
   • Elite fungi (id: 1f887843-...)

▶ Тест 4: Меню
✅ Товаров: 0 | Групп: 0 (пусто)

▶ Тест 5: Стоп-лист
✅ Стоп-листов: 0

▶ Тест 6: Склад
⚠️ 401 — ограничение тарифа
```

## Переменные окружения

```env
IIKO_API_BASE=https://api-ru.iiko.services
IIKO_API_KEY=...
IIKO_APP_ID=...           # UUID
IIKO_CLIENT_SECRET=...
IIKO_ORGANIZATION_ID=084cf002-ef41-4d35-88e5-8026413c05eb
IIKO_TERMINAL_GROUP_ID=1f887843-83ee-71f9-019d-44005e1d0066
```

## Организация

- **Название:** Elite fungi
- **Organization ID:** `084cf002-ef41-4d35-88e5-8026413c05eb`
- **Terminal Group ID:** `1f887843-83ee-71f9-019d-44005e1d0066`
- **posVersion:** `9.4.8049.0`
## Синхронизация меню

Товары из IIKO сохраняются в таблицу **`external_products`**:

| Поле | Откуда |
|------|--------|
| `external_id` | IIKO `itemId` |
| `name` | IIKO `name` |
| `sku` | IIKO `sku` |
| `category_name` | IIKO `itemCategories[].name` |
| `price_rub` | IIKO `itemSizes[0].prices[0].price / 100` |

**Важно:** цены в IIKO — **в копейках**, поэтому делим на 100.

**Связь с нашими товарами** — через `external_id_mapping`:
internal_table = 'external_products'
external_system = 'iiko'

### Синхронизация
```bash
node connectors/iiko/sync-menu.js
Cron: каждые 15 минут

Логи: /var/log/iiko-sync-menu.log
## Ограничения

- **Меню** — пусто (ждём заказчика)
- **Склад** (`/api/1/stock/balance`) — 401, ограничение тарифа

## Что ждёт заказчика

1. **Заполнить меню в IIKO** (iikoWeb → Номенклатура)
2. **Дать ТЗ по синхронизации:**
   - Что синхронизировать?
   - Направление?
   - Вебхуки?
3. **Разрешение на тестовый заказ**

## Полезные ссылки

- **Документация API:** https://api-ru.iiko.services/docs
- **Developer Portal:** https://public-api.iikoweb.ru/portal
- **iikoWeb:** https://ip-elite-fungi-krg.iiko.it/resto/
- **Поддержка IIKO:** https://ru.iiko.help/
