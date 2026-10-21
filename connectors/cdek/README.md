# CDEK коннектор

Порт: `CDEK_WEBHOOK_PORT` (3003). pm2: `cdek-connector`.
API: `CDEK_API_BASE` (https://api.cdek.ru/v2), OAuth `client_credentials` — `CDEK_CLIENT_ID`, `CDEK_CLIENT_SECRET` (ЛК СДЭК → Интеграция).

## CDEK → Hub (вебхук)
`POST /webhook/cdek?secret=<CDEK_WEBHOOK_SECRET>` (или заголовок `X-Webhook-Secret`).

| Формат | eventType |
|---|---|
| вебхук СДЭК `{"type":"ORDER_STATUS","uuid":...,"attributes":{"code":...}}` | `cdek.order.status_updated` |
| полный заказ `{"order":{...}}` / `{"orders":[...]}` (из API) | `cdek.order.updated` |

`operationKey = cdek_<uuid>_<status_date_time>` — повтор того же вебхука → `duplicate`.
Сумма заказа из СДЭК не передаётся (`delivery_sum` — стоимость доставки, а не заказа).

## Статусы
| СДЭК | → orders.status |
|---|---|
| CREATED | new |
| ACCEPTED, RECEIVED_AT_SHIPMENT_WAREHOUSE, READY_*_SENDER_* | processing |
| TAKEN_BY_TRANSPORTER_*, SENT_TO_*, ACCEPTED_IN_*_CITY, TAKEN_BY_COURIER | delivering |
| ACCEPTED_AT_PICK_UP_POINT | ready |
| DELIVERED | delivered |
| NOT_DELIVERED | failed |
| INVALID, CANCELLED, REFUSED | cancelled |

Неизвестный код — статус не меняется, в логе предупреждение.
Регистрация вебхука в СДЭК (после ключей): `POST /v2/webhooks` с `type=ORDER_STATUS` и URL `http://<сервер>:3003/webhook/cdek?secret=...`.

## Проверка
`node connectors/cdek/test-connection.js` · `./scripts/test-all-connectors.sh`
