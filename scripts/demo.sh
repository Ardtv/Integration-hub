#!/bin/bash
# Демо: amoCRM → заказ в БД


SECRET=$(grep AMO_WEBHOOK_SECRET ~/integration-hub/.env | cut -d= -f2)
echo "════════════════════════════════════════"
echo " ДЕМО: Интеграция amoCRM → БД"
echo "════════════════════════════════════════"
echo ""

echo "▶ Шаг 1: Сервисы работают"
curl -s http://localhost:3001/health | head -c 200
echo ""
curl -s http://localhost:3002/health
echo ""
echo ""

echo "▶ Шаг 2: Создаю сделку в amoCRM (эмуляция)"
curl -s -X POST http://localhost:3002/webhook/amo \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"_embedded":{"leads":[{"id":77777,"name":"Демо сделка","price":9999,"status_id":142,"_embedded":{"contacts":[{"name":"Демо Клиент","custom_fields_values":[{"field_code":"PHONE","values":[{"value":"+79991234567"}]}]}]}}]}}'
echo ""
sleep 5

echo "▶ Шаг 3: Заказ уже в БД"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders WHERE customer_phone='+79991234567';"
echo ""

echo "▶ Шаг 4: Сделка оплачена (status_id=144)"
curl -s -X POST http://localhost:3002/webhook/amo \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"leads":{"status":[{"id":77777,"status_id":144}]}}'
echo ""
sleep 5

echo "▶ Шаг 5: Статус заказа обновился"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders WHERE customer_phone='+79991234567';"
echo ""

echo "════════════════════════════════════════"
echo " ✅ ДЕМО ЗАВЕРШЕНО"
echo "════════════════════════════════════════"

# Очистка
sudo -u postgres psql -d instinct_db -c "
DELETE FROM external_id_mapping WHERE external_id='77777';
DELETE FROM orders WHERE customer_phone='+79991234567';
DELETE FROM users WHERE phone='+79991234567';" > /dev/null

echo "Тестовые данные очищены."
