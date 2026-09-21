# E2E Test: Kommo → Order in DB

## Предусловия
- Hub запущен: pm2 list | grep hub → online
- curl -s http://localhost:3001/health → {"status":"ok"}

## 1. Очистить очередь
sudo -u postgres psql -d instinct_db -c "DELETE FROM integration_queue WHERE status IN ('failed','pending');"

## 2. Отправить событие
curl -X POST http://localhost:3001/api/events -H "Content-Type: application/json" -d '{"eventType":"deal.created","source":"kommo","payload":{"external_id":"e2e_1","external_system":"kommo","order":{"customer_name":"E2E","customer_phone":"+79990001122","currency":"RUB","total_amount_minor":12345,"status":"new"}},"operationKey":"e2e_1"}'

## 3. Проверить
sleep 5
sudo -u postgres psql -d instinct_db -c "SELECT o.id, o.user_id, u.phone, o.customer_name, o.total_amount_minor FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 3;"

## Ожидаемо
- integration_queue.status = 'processed'
- orders: новая строка с user_id, customer_name, total_amount_minor
- users: phone = '+79990001122'
- external_id_mapping: связь orders.id ↔ external_id = 'e2e_1'
## Проверка X-Api-Token

Hub принимает запросы только с заголовком `X-Api-Token`.

### Без токена (ожидаем 401)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{"eventType":"test","source":"test","payload":{"id":1}}'
```

Ожидаемо: `401`

### С токеном (ожидаем 200)

```bash
TOKEN=$(grep HUB_API_TOKEN ~/integration-hub/.env | cut -d= -f2)

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"test","source":"test","payload":{"id":2}}'
```

Ожидаемо: `200`

## Сценарий: обновление и смена статуса заказа

```bash

TOKEN=$(grep HUB_API_TOKEN ~/integration-hub/.env | cut -d= -f2)

# 1) Создать заказ
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"deal.created","source":"kommo","payload":{"external_id":"e2e_status","external_system":"kommo","order":{"customer_name":"E2E Status","customer_phone":"+79990004444","currency":"RUB","total_amount_minor":10000,"status":"new"}},"operationKey":"e2e_status_v1"}'

sleep 4

# 2) Обновить сумму
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"deal.updated","source":"kommo","payload":{"external_id":"e2e_status","external_system":"kommo","order":{"customer_name":"E2E Status","customer_phone":"+79990004444","currency":"RUB","total_amount_minor":77777,"status":"new"}},"operationKey":"e2e_status_v2"}'

sleep 4

# 3) Сменить статус
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"deal.status_updated","source":"kommo","payload":{"external_id":"e2e_status","external_system":"kommo","order":{"customer_name":"E2E Status","customer_phone":"+79990004444","currency":"RUB","total_amount_minor":77777,"status":"paid"}},"operationKey":"e2e_status_v3"}'

sleep 5

sudo -u postgres psql -d instinct_db -c "SELECT id, customer_name, total_amount_minor, status FROM orders WHERE customer_name='E2E Status';"
```

Ожидаемо: одна строка с `total_amount_minor=77777`, `status='paid'`.
