#!/bin/bash
# E2E Test Suite: amoCRM → Hub → DB
# Прогоняет 5 сценариев и показывает результат

set -e

HUB_URL="http://localhost:3001"
AMO_URL="http://localhost:3002"
SECRET=$(grep AMO_WEBHOOK_SECRET ~/integration-hub/.env | cut -d= -f2)

echo "════════════════════════════════════════════════════════"
echo " E2E TEST SUITE — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────
# Очистка очереди перед тестом
# ─────────────────────────────────────────────
echo "▶ Очистка очереди..."
sudo -u postgres psql -d instinct_db -c "DELETE FROM integration_queue WHERE status IN ('failed','pending');" > /dev/null
echo ""

# ─────────────────────────────────────────────
# Сценарий 1: Создание заказа
# ─────────────────────────────────────────────
echo "════════ Сценарий 1: СОЗДАНИЕ ════════"
RESPONSE=$(curl -s -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"_embedded":{"leads":[{"id":99000,"name":"E2E Create","price":1000,"status_id":142,"_embedded":{"contacts":[{"name":"Тест Клиент","custom_fields_values":[{"field_code":"PHONE","values":[{"value":"+79991239999"}]}]}]}}]}}')
echo "Ответ amo-connector: $RESPONSE"
sleep 5

echo "Заказ в БД:"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders WHERE customer_phone='+79991239999';"
echo ""

# ─────────────────────────────────────────────
# Сценарий 2: Обновление цены
# ─────────────────────────────────────────────
echo "════════ Сценарий 2: ОБНОВЛЕНИЕ ЦЕНЫ ════════"
RESPONSE=$(curl -s -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"leads":{"update":[{"id":99000,"price":2000,"status_id":142}]}}')
echo "Ответ amo-connector: $RESPONSE"
sleep 5

echo "Заказ в БД (цена обновилась, имя/телефон НЕ затёрты):"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders WHERE customer_phone='+79991239999';"
echo ""

# ─────────────────────────────────────────────
# Сценарий 3: Смена статуса
# ─────────────────────────────────────────────
echo "════════ Сценарий 3: СМЕНА СТАТУСА ════════"
RESPONSE=$(curl -s -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"leads":{"status":[{"id":99000,"status_id":144}]}}')
echo "Ответ amo-connector: $RESPONSE"
sleep 5

echo "Заказ в БД (статус = paid):"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders WHERE customer_phone='+79991239999';"
echo ""

# ─────────────────────────────────────────────
# Сценарий 4: Без телефона (fallback)
# ─────────────────────────────────────────────
echo "════════ Сценарий 4: БЕЗ ТЕЛЕФОНА (fallback) ════════"
RESPONSE=$(curl -s -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"_embedded":{"leads":[{"id":99001,"name":"No Phone","price":500,"status_id":142}]}}')
echo "Ответ amo-connector: $RESPONSE"
sleep 5

echo "Заказ в БД (phone = unknown_99001):"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, status
FROM orders WHERE customer_name='No Phone';"
echo ""

# ─────────────────────────────────────────────
# Сценарий 5: Retry при недоступности hub
# ─────────────────────────────────────────────
echo "════════ Сценарий 5: RETRY (hub выключен) ════════"
echo "Останавливаю hub..."
pm2 stop hub > /dev/null
sleep 2

RESPONSE=$(curl -s -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"_embedded":{"leads":[{"id":99002,"name":"Retry Test","price":100,"status_id":142}]}}')
echo "Ответ amo-connector (должен быть error): $RESPONSE"
echo ""

echo "Ожидаю retry..."
sleep 12

echo "Логи retry (из error.log):"
tail -20 ~/.pm2/logs/amo-connector-error.log | grep -E "Retry|попытки|ECONNREFUSED" || echo "(нет строк)"

echo ""
echo "Включаю hub..."
pm2 start hub > /dev/null
sleep 3
curl -s "$HUB_URL/health"
echo ""
echo ""

# ─────────────────────────────────────────────
# Итоговая проверка mapping
# ─────────────────────────────────────────────
echo "════════ Итог: mapping ════════"
sudo -u postgres psql -d instinct_db -c "
SELECT internal_table, internal_id, external_system, external_id
FROM external_id_mapping WHERE external_id LIKE '990%'
ORDER BY internal_id;"
echo ""

# ─────────────────────────────────────────────
# Очистка
# ─────────────────────────────────────────────
# ─────────────────────────────────────────────
# Сценарий 6: Без секрета (401)
# ─────────────────────────────────────────────
echo "════════ Сценарий 6: БЕЗ СЕКРЕТА (401) ════════"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AMO_URL/webhook/amo" \
  -H "Content-Type: application/json" \
  -d '{"_embedded":{"leads":[{"id":99999,"name":"No Secret","price":1}]}}')
echo "HTTP код: $HTTP (ожидаем 401)"
if [ "$HTTP" = "401" ]; then
    echo "✅ Проверка секрета работает"
else
    echo "❌ Ожидался 401, получили $HTTP"
fi
echo ""
echo "════════ Очистка тестовых данных ════════"
sudo -u postgres psql -d instinct_db -c "
DELETE FROM external_id_mapping WHERE external_id IN ('99000','99001','99002');
DELETE FROM orders WHERE customer_phone IN ('+79991239999','unknown_99000','unknown_99001','unknown_99002') OR customer_name IN ('No Phone','Retry Test','E2E Create');
DELETE FROM users WHERE phone IN ('+79991239999','unknown_99000','unknown_99001','unknown_99002');" > /dev/null

echo ""
echo "════════════════════════════════════════════════════════"
echo " ✅ E2E TEST SUITE COMPLETED"
echo "════════════════════════════════════════════════════════"
