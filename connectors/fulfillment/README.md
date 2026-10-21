# Fulfillment коннектор

Порт: `FULFILLMENT_WEBHOOK_PORT` (3004). pm2: `fulfillment-connector`.
API: `FULFILLMENT_API_BASE`, ключ `FULFILLMENT_API_KEY` (Bearer). Сервис фулфилмента не выбран — формат ниже предварительный, уточнить у заказчика.

## Fulfillment → Hub (вебхук)
`POST /webhook/fulfillment?secret=<FULFILLMENT_WEBHOOK_SECRET>`.
Тело: `{"shipment":{...}}` или `{"shipments":[...]}`.

```json
{ "shipment": { "id": "...", "number": "FF-1", "status": "assembling", "updated_at": "...",
  "total": 990, "customer": { "name": "...", "phone": "..." },
  "items": [{ "sku": "SKU-1", "name": "...", "quantity": 1, "price": 990 }] } }
```

eventType: `fulfillment.shipment.updated`. `operationKey = fulfillment_<id>_<updated_at|status>`.

## Статусы
| Fulfillment | → orders.status |
|---|---|
| pending | pending_payment |
| assembling | processing |
| ready | ready |
| shipped | delivering |
| delivered | delivered |
| cancelled | cancelled |

Неизвестный статус — не меняется. Ответ 500 — hub не принял, сервис должен повторить.

## Проверка
`node connectors/fulfillment/test-connection.js` · `./scripts/test-all-connectors.sh`
