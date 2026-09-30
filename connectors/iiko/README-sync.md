# IIKO Sync — Руководство

## Обзор

Три скрипта для синхронизации:

| Скрипт | Расписание | Направление |
|--------|-----------|-------------|
| `sync-menu.js` | каждые 15 мин | IIKO → `products` |
| `send-order.js` | по запросу | Hub → IIKO |
| `sync-status.js` | каждые 5 мин | IIKO → `orders` |

## sync-menu.js

**Что делает:**
1. Получает меню из IIKO (`getNomenclature`)
2. Для каждого товара:
   - Ищет в `external_id_mapping` (iiko ID ↔ products.id)
   - Если есть — обновляет
   - Если нет — создаёт в `products` + mapping
3. Логирует результат

**Запуск:**
```bash
node connectors/iiko/sync-menu.js
```

**Cron:** каждые 15 минут

**Логи:** `/var/log/iiko-sync-menu.log`

## send-order.js

**Что делает:**
1. Принимает заказ из Hub
2. Маппит `product_id` → IIKO `productId`
3. Отправляет через `createDeliveryOrder()`
4. Сохраняет `iiko_order_id` в `orders`

**Использование:**

```javascript
const { sendOrderToIiko } = require('./send-order');

const result = await sendOrderToIiko({
    id: 123,
    customer_phone: '+79991234567',
    delivery_address: 'Москва, ул. Ленина 1',
    items: [{ product_id: 1, quantity: 2 }]
});
```

## sync-status.js

**Что делает:**
1. Берёт заказы с `iiko_order_id`
2. Запрашивает статус через `getOrderById()`
3. Маппит IIKO статус → наш
4. Обновляет в БД

**Запуск:**
```bash
node connectors/iiko/sync-status.js
```

**Cron:** каждые 5 минут

## Маппинг статусов IIKO → наши

| IIKO | Наш |
|------|-----|
| New | new |
| WaitCooking | processing |
| Cooking | processing |
| CookingCompleted | ready |
| OnWay | delivering |
| Delivered | delivered |
| Closed | completed |
| Cancelled | cancelled |

## Cron — установка

```bash
~/integration-hub/scripts/setup-iiko-cron.sh
```

**Проверить:**
```bash
crontab -l | grep iiko
```

## Troubleshooting

### `column "iiko_order_id" does not exist`
```bash
sudo -u postgres psql -d instinct_db -c "ALTER TABLE orders ADD COLUMN IF NOT EXISTS iiko_order_id VARCHAR(64);"
```

### `invalid input value for enum "OrderStatus"`
Расширить enum:
```bash
sudo -u postgres psql -d instinct_db << 'EOSQL'
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ready';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'delivering';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'completed';
EOSQL
```

### `Product X не найден в mapping с IIKO`
Запустить `sync-menu.js` для создания mapping.
