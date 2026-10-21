#!/bin/bash
TOKEN=$(grep HUB_API_TOKEN ~/integration-hub/.env | cut -d= -f2)

echo "════════ E2E STAGE 2 ════════"

echo "▶ Fulfillment"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"fulfillment.order.ready","source":"fulfillment","payload":{"fulfillment_id":"E2E-FF","status":"READY","status_code":"2","warehouse":"Main"},"operationKey":"e2e_ff_'$RANDOM'"}'
echo ""

echo "▶ Marketplace"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"marketplace.order.created","source":"marketplace","payload":{"marketplace":"ozon","order_id":"E2E-OZ","status":"new","total_amount_minor":100000,"currency":"KZT"},"operationKey":"e2e_mp_'$RANDOM'"}'
echo ""

echo "▶ 1C"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"1c.order.created","source":"1c","payload":{"onec_id":"E2E-1C","order_number":"999","total":5000},"operationKey":"e2e_1c_'$RANDOM'"}'
echo ""

echo "▶ MoySklad"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $TOKEN" \
  -d '{"eventType":"moysklad.product.updated","source":"moysklad","payload":{"product_id":"E2E-MS","name":"Товар","price":1000,"stock":10},"operationKey":"e2e_ms_'$RANDOM'"}'
echo ""

sleep 8

echo "════════ РЕЗУЛЬТАТ ════════"
sudo -u postgres psql -d instinct_db -c "
SELECT source, event_type, status, error_message
FROM integration_queue
WHERE operation_key LIKE 'e2e_%'
ORDER BY id DESC LIMIT 10;"

echo ""
echo "════════ DONE ════════"
