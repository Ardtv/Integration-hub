# Marketplace коннектор (Ozon, WB, Kaspi)

Порт: `MARKETPLACE_WEBHOOK_PORT` (3005). pm2: `marketplace-connector`.
Вебхуки: `POST /webhook/ozon`, `/webhook/wb`, `/webhook/kaspi` + `?secret=<MARKETPLACE_WEBHOOK_SECRET>`.

Тело: `{"order":{...}}` или `{"orders":[...]}`, ключ заказа — `posting_number`.
eventType: `marketplace.order.updated`, source = `ozon` | `wb` | `kaspi`.
external_id = `<платформа>_<posting_number>`, `operationKey = <external_id>_<updated_at|status>`.

## Статусы
| Площадка | → orders.status |
|---|---|
| awaiting_packaging | pending_payment |
| awaiting_deliver | processing |
| delivering | delivering |
| delivered | delivered |
| cancelled | cancelled |

## ⚠️ Доработать при получении ключей и ТЗ
- **Авторизация:** сейчас всем шлётся `Authorization: Bearer`. Нужно:
  Ozon — заголовки `Client-Id` + `Api-Key` (`https://api-seller.ozon.ru`);
  WB — токен в `Authorization` без Bearer, домен `marketplace-api.wildberries.ru` (старый `suppliers-api` не резолвится);
  Kaspi — `X-Auth-Token` (`https://kaspi.kz/shop/api/v2`).
- **Получение заказов:** WB и Kaspi вебхуков не шлют — нужен опрос по расписанию (cron, как IIKO). У Ozon push-уведомления в своём формате.
- Ping в `test-connection.js` бьёт в `/health`, которого у площадок нет — заменить на реальные методы.

## Проверка
`node connectors/marketplace/test-connection.js` · `./scripts/test-all-connectors.sh`
