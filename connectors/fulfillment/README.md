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

## СДЭК Фулфилмент: остатки (Orderadmin API)
Кабинет seller.ffcdek.ru работает на Orderadmin. API: `FF_API_BASE` (https://cdek.api.orderadmin.ru).
Вход: `POST /oauth` (`grant_type=password`, `client_id=orderadmin`, `domain=cdek`, логин/пароль кабинета — `FF_USERNAME`/`FF_PASSWORD`).
Ключи СДЭК у фулфилмента те же, что в lk.cdek.ru — заказы СДЭК по договору попадают на склад автоматически.

`connectors/fulfillment/sync-stock.js` — раз в 30 мин: `GET /api/products/offer` → событие `fulfillment.stock.updated`
(`external_system=cdek_ff`, `product.stock` — остаток в состоянии normal, цены в `FF_CURRENCY`, договор в KZT).
Служебные позиции (`state=inactive`) пропускаются. Неизменённые остатки → `duplicate`. `--dry-run` — только показать.
Лог: `tail /var/log/ff-stock-sync.log`.
