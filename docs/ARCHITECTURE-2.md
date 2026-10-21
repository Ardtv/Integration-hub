# Архитектура Этапа 2

## Общая схема
amoCRM → Hub → CDEK → Fulfillment → Маркетплейсы
↓
1С ← Hub → МойСклад

## Компоненты

| Коннектор | Порт | Назначение | Статус |
|-----------|------|-----------|--------|
| `amo` | 3002 | amoCRM → Hub | ✅ |
| `iiko` | — | Hub → IIKO | ✅ |
| `cdek` | 3003 | CDEK → Hub | ⏳ |
| `fulfillment` | 3004 | Fulfillment → Hub | ⏳ |
| `marketplace` | 3005 | Ozon/WB/Kaspi → Hub | ⏳ |
| `1c` | 3006 | 1С → Hub | ⏳ |
| `moysklad` | — | Hub → МойСклад | ⏳ |

## События

### CDEK
| Событие | Назначение |
|---------|-----------|
| `cdek.order.created` | Создано отправление |
| `cdek.order.status_updated` | Статус отправления |

### Fulfillment
| Событие | Назначение |
|---------|-----------|
| `fulfillment.order.ready` | Заказ готов к отгрузке |
| `fulfillment.shipment.created` | Создана отгрузка |

### Marketplace
| Событие | Назначение |
|---------|-----------|
| `marketplace.order.created` | Заказ с маркетплейса |
| `marketplace.order.status_updated` | Статус заказа |

### 1С
| Событие | Назначение |
|---------|-----------|
| `1c.order.synced` | Заказ синхронизирован |
| `1c.product.synced` | Товар синхронизирован |

### МойСклад
| Событие | Назначение |
|---------|-----------|
| `moysklad.product.synced` | Товары синхронизированы |
| `moysklad.stock.synced` | Остатки синхронизированы |

## Таблицы БД

| Таблица | Назначение |
|---------|-----------|
| `orders` | Заказы |
| `users` | Клиенты |
| `external_products` | Товары IIKO |
| `cdek_orders` | Отправления CDEK |
| `fulfillment_shipments` | Отгрузки Fulfillment |
| `marketplace_orders` | Заказы маркетплейсов |
| `integration_queue` | Очередь событий |
| `external_id_mapping` | Связи с внешними системами |
| `integration_logs` | Логи |

## Переменные окружения

```env
# Hub
HUB_PORT=3001
HUB_API_TOKEN=...
DB_HOST=localhost
DB_NAME=instinct_db
DB_USER=instinct_user
DB_PASSWORD=...

# amoCRM
AMO_API_DOMAIN=instinkt.amocrm.ru
AMO_API_TOKEN=...
AMO_WEBHOOK_SECRET=...

# IIKO
IIKO_API_KEY=...
IIKO_APP_ID=...
IIKO_CLIENT_SECRET=...
IIKO_ORGANIZATION_ID=...
IIKO_TERMINAL_GROUP_ID=...

# CDEK
CDEK_CLIENT_ID=...
CDEK_CLIENT_SECRET=...
CDEK_WEBHOOK_PORT=3003

# Fulfillment
FULFILLMENT_API_URL=...
FULFILLMENT_WEBHOOK_PORT=3004

# Marketplace
OZON_CLIENT_ID=...
OZON_API_KEY=...
WB_API_KEY=...
KASPI_API_KEY=...
MARKETPLACE_WEBHOOK_PORT=3005

# 1С
ONEC_API_URL=...
ONEC_WEBHOOK_PORT=3006

# МойСклад
MOYSKLAD_TOKEN=...
