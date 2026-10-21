# МойСклад коннектор

Порт: `MOYSKLAD_WEBHOOK_PORT` (3007). pm2: `moysklad-connector`.
API: `https://api.moysklad.ru/api/remap/1.2`, токен `MOYSKLAD_TOKEN` (МойСклад → Настройки → Токены).

## МойСклад → Hub (вебхук)
`POST /webhook/moysklad?secret=<MOYSKLAD_WEBHOOK_SECRET>`.
МойСклад присылает только ссылку на товар (`events[].meta.href`) — коннектор сам дозапрашивает товар по API.

| action | → eventType |
|---|---|
| CREATE | moysklad.product.created |
| UPDATE | moysklad.product.updated |
| DELETE | moysklad.product.deleted |

## Поля
| МойСклад | → product |
|---|---|
| id | external_id |
| name | name |
| article / code | sku |
| salePrices[0].value | price_minor (МойСклад отдаёт цены уже в копейках) |
| archived | archived |
| barcodes | barcodes |

## Регистрация вебхуков (после получения токена)
```bash
cd ~/integration-hub
node -e "
require('dotenv').config({ quiet: true });
const c = require('./connectors/moysklad/moysklad-client');
const url = 'http://<ВНЕШНИЙ_АДРЕС>:3007/webhook/moysklad?secret=' + process.env.MOYSKLAD_WEBHOOK_SECRET;
(async () => { for (const a of ['CREATE','UPDATE','DELETE']) console.log(a, (await c.createWebhook(url, 'product', a)).id); })().catch(e => console.error(e.response?.data || e.message));
"
```

## Проверка
`node connectors/moysklad/test-connection.js` — товары, остатки, список вебхуков.
