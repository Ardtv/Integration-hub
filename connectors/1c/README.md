# 1С коннектор

Порт: `API_1C_WEBHOOK_PORT` (3006). pm2: `1c-connector`.

## 1С → Hub (вебхук)
`POST /webhook/1c?secret=<API_1C_WEBHOOK_SECRET>` (или заголовок `X-Webhook-Secret`), `Content-Type: application/json`.

Тело — один заказ (`order`) или пачка (`orders`):

```json
{
  "order": {
    "id": "GUID документа (Ref_Key)",
    "number": "ЗК-000123",
    "date": "2026-10-21",
    "version": "дата изменения или номер версии",
    "status": "new | confirmed | paid | assembled | shipped | delivered | closed | cancelled",
    "sum": 1500.50,
    "currency": "RUB",
    "address": "Москва, Тверская 1",
    "customer": { "name": "Иван Иванов", "phone": "+79991112233" },
    "items": [{ "code": "SKU-1", "name": "Товар", "quantity": 2, "price": 750.25 }]
  }
}
```

| 1С status | → orders.status |
|---|---|
| new | new |
| confirmed | processing |
| paid | paid |
| assembled | ready |
| shipped | delivering |
| delivered | delivered |
| closed | completed |
| cancelled | cancelled |

Событие в hub: `source=1c`, `eventType=1c.order.updated`, `external_system=1c`.
Ответ: 200 — принято, 500 — hub недоступен (1С должна повторить отправку).

## Hub → 1С (чтение, OData)
`API_1C_BASE` — адрес `.../odata/standard.odata`, Basic-авторизация (`API_1C_USER`/`API_1C_PASSWORD`).
Документ заказа задаётся `API_1C_ORDER_DOCUMENT` (УТ 11: `Document_ЗаказКлиента`, УНФ: `Document_ЗаказПокупателя`).
В 1С должен быть опубликован OData-интерфейс и включён нужный документ в составе.

## Проверка
`node connectors/1c/test-connection.js`
