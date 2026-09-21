# amoCRM → Hub: connector

## Назначение
Принимает вебхуки от amoCRM на порту 3002 и отправляет нормализованные события в `integration-hub` (`http://localhost:3001/api/events`).

## Запуск
```bash
pm2 start "node connectors/amo/webhook-server.js" --name amo-connector
```

## Переменные окружения (.env)
| Переменная | Описание | По умолчанию |
|---|---|---|
| `AMO_WEBHOOK_PORT` | Порт, на котором слушает коннектор | `3002` |
| `HUB_URL` | URL hub | `http://localhost:3001` |
| `HUB_API_TOKEN` | Токен авторизации в hub | (обязателен) |

## Эндпоинты
- `POST /webhook/amo` — приём вебхуков от amoCRM
- `GET /health` — проверка живости

## Типы входящих событий
amoCRM присылает события в одном из двух форматов:

### 1. Реальный формат amoCRM
```json
{
  "leads": {
    "add":    [{ "id": 123, "name": "...", "price": 100, "status_id": 142 }],
    "update": [{ "id": 123, "name": "...", "price": 200 }],
    "status": [{ "id": 123, "status_id": 144 }]
  }
}
```

Маппинг в `eventType` для hub:

| amoCRM | `eventType` в hub |
|---|---|
| `leads.add` | `deal.created` |
| `leads.update` | `deal.updated` |
| `leads.status` | `deal.status_updated` |

### 2. Тестовый формат (mock)
```json
{
  "_embedded": {
    "leads": [ { "id": 123, "name": "...", "price": 100 } ]
  }
}
```

Всегда → `deal.created`.

## Маппинг полей amoCRM → Hub

| amoCRM (source) | → | Hub/DB (target) |
|---|---|---|
| `_embedded.leads[0].id` | → | `orders.external_id` |
| `_embedded.leads[0]._embedded.contacts[0].name` | → | `orders.customer_name` / `users.first_name` |
| `_embedded.leads[0].name` (fallback) | → | `orders.customer_name` |
| `contacts[0].custom_fields_values[PHONE]` | → | `orders.customer_phone` / `users.phone` |
| `leads[0].custom_fields_values[PHONE]` (fallback) | → | `orders.customer_phone` |
| `leads[0].custom_fields_values[ADDRESS]` | → | `orders.delivery_address` |
| `leads[0].price` (₽) | → | `orders.total_amount_minor` (× 100) |
| `leads[0].status_id` | → | `orders.status` (см. маппинг ниже) |

## Обработка deal.created vs deal.updated

Для `deal.created` заглушки подставляются, чтобы заказ создался даже без данных:
- `customer_name = 'Unknown'` (если нет контакта и имени сделки)
- `customer_phone = 'unknown_<id>'` (если нет телефона)

Для `deal.updated` и `deal.status_updated` заглушки **НЕ** подставляются (`null`), чтобы `update()` в hub не затирал существующие данные заказа. Пропуск `null`-полей обеспечивает `order.repository.ts` (проверка `value !== undefined && value !== null`).

### Пример

deal.created — заглушки

{"customer_name": "Unknown", "customer_phone": "unknown_99001", "total_amount_minor": 0}
deal.updated — null (не затирает)

{"customer_name": null, "customer_phone": null, "total_amount_minor": 500000}

## Маппинг статусов amoCRM → orders.status

| `status_id` amoCRM | amoCRM | → | `orders.status` |
|---|---|---|---|
| 142 | Неразобранное | → | `new` |
| 143 | Первый контакт | → | `pending_payment` |
| 144 | Оплата | → | `paid` |
| 145 | Закрыто и не реализовано | → | `cancelled` |
| (любой другой) | — | → | `new` |

## Правила
- Телефона нет ни у контакта, ни у сделки → `customer_phone = 'unknown_<lead.id>'`
- Сумма умножается на 100 (копейки)
- Для `deal.status_updated` **не отправляются** поля `customer_name`, `customer_phone`, `total_amount_minor` — только `status`. Иначе hub затрёт данные заказа.

## Retry при недоступности hub
Если hub недоступен, `sendWithRetry` делает 3 попытки с exponential backoff:

| Попытка | Задержка перед попыткой |
|---|---|
| 1 | 0 (сразу) |
| 2 | 2000 мс |
| 3 | 4000 мс |

После 3 неудачных попыток возвращается ошибка, amoCRM может повторить вебхук позже.

## Авторизация в hub
Все запросы к hub отправляются с заголовком:
```
X-Api-Token: <HUB_API_TOKEN>
```

Без токена hub отвечает `401 Unauthorized`.

## Отладка
```bash
# Логи
pm2 logs amo-connector --lines 50
pm2 logs hub --lines 50

# Health check
curl -s http://localhost:3002/health
curl -s http://localhost:3001/health

# Тест вручную
curl -X POST http://localhost:3002/webhook/amo \
  -H "Content-Type: application/json" \
  -d '{"_embedded":{"leads":[{"id":99999,"name":"Test","price":100,"status_id":142}]}}'
```

### Что искать в логах
- `📨 Получен вебхук от AmoCRM:` — сырое тело
- `📦 [deal.created] Извлечён заказ:` — что извлекли
- `✅ [deal.created] Отправлено в Хаб:` — ответ hub
- `⏳ Retry N/2 через ...ms...` — повторные попытки
- `❌ Все 3 попытки исчерпаны` — hub недоступен
## Безопасность

Вебхуки защищены заголовком `X-Webhook-Secret`. Значение задаётся в `.env`:

AMO_WEBHOOK_SECRET=<hex>


Без заголовка → `401 Unauthorized`.

## Обработка customer_email и items

- `customer_email` — извлекается из `contacts[0].custom_fields_values[EMAIL]`, fallback: `leads[0].custom_fields_values[EMAIL]`
- `items` — извлекается из `_embedded.catalog_elements` (или `_embedded.items`), маппится в `external_order_items`

## Обработка deal.deleted

- `leads.delete` → `deal.deleted`
- Hub обрабатывает: статус заказа → `cancelled`
