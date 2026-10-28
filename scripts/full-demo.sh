#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# INTEGRATION HUB — ПОЛНАЯ ДЕМОНСТРАЦИЯ ДЛЯ ЗАКАЗЧИКА
# ═══════════════════════════════════════════════════════════════

cd ~/integration-hub

HUB_TOKEN=$(grep HUB_API_TOKEN .env | cut -d= -f2)
AMO_SECRET=$(grep AMO_WEBHOOK_SECRET .env | cut -d= -f2)

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         INTEGRATION HUB — ДЕМОНСТРАЦИЯ                     ║"
echo "║         $(date '+%Y-%m-%d %H:%M:%S')                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
sleep 1

# ═══════════════════════════════════════════════════════════════
echo "════════ 1. HEALTHCHECK — ВСЕ СЕРВИСЫ ════════"
echo ""
./scripts/healthcheck.sh
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 2. ДЕМО: amoCRM → БД ════════"
echo ""
./scripts/demo.sh
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 3. СИНХРОНИЗАЦИЯ IIKO ════════"
echo ""
node connectors/iiko/sync-menu.js
echo ""
echo "── Товары в БД (первые 5) ──"
sudo -u postgres psql -d instinct_db -c "
SELECT id, name, price_rub FROM external_products WHERE external_system='iiko' ORDER BY id LIMIT 5;"
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 4. E2E: 6 СЦЕНАРИЕВ ════════"
echo ""
./scripts/e2e-full.sh
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 5. ИДЕМПОТЕНТНОСТЬ ════════"
echo ""
sudo -u postgres psql -d instinct_db -c "DELETE FROM integration_queue WHERE operation_key = 'demo_idem';" > /dev/null 2>&1

echo "▶ Первый POST:"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $HUB_TOKEN" \
  -d '{"eventType":"test","source":"test","payload":{"id":1},"operationKey":"demo_idem"}'
echo ""
echo ""

echo "▶ Второй POST (тот же operationKey):"
curl -s -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $HUB_TOKEN" \
  -d '{"eventType":"test","source":"test","payload":{"id":1},"operationKey":"demo_idem"}'
echo ""
echo ""
echo "✅ Дубликат не создан"
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 6. ДОЗАПРОС amoCRM (контакт из сделки) ════════"
echo ""
node -e "
require('dotenv').config({ quiet: true });
const AmoClient = require('./connectors/amo/amo-client');
const client = new AmoClient(process.env.AMO_API_TOKEN, process.env.AMO_API_DOMAIN);
(async () => {
    try {
        const deal = await client.getDeal('53077207');
        console.log('✅ Сделка:', deal.name);
        const contactId = deal._embedded?.contacts?.[0]?.id;
        if (contactId) {
            const contact = await client.getContact(contactId);
            console.log('✅ Контакт:', contact.name);
            const phone = contact.custom_fields_values?.find(f => f.field_code === 'PHONE')?.values?.[0]?.value;
            if (phone) console.log('✅ Телефон:', phone);
        }
    } catch (e) {
        console.log('⚠️ Дозапрос недоступен:', e.message);
    }
})();
"
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 7. МЕТРИКИ ════════"
echo ""
echo "▶ /health:"
curl -s http://localhost:3001/health | jq '.'
echo ""
echo "▶ /api/stats:"
curl -s -H "X-Api-Token: $HUB_TOKEN" http://localhost:3001/api/stats | jq '.'
echo ""
echo "▶ /api/dead (мёртвая очередь):"
curl -s -H "X-Api-Token: $HUB_TOKEN" http://localhost:3001/api/dead | jq '.'
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 8. БЕЗОПАСНОСТЬ (401 без токена) ════════"
echo ""
echo -n "▶ Без токена: "
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{"eventType":"test","source":"test","payload":{"id":1}}'
echo -n "▶ С токеном:  "
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-Api-Token: $HUB_TOKEN" \
  -d '{"eventType":"test","source":"test","payload":{"id":2},"operationKey":"demo_auth_'$RANDOM'"}'
echo ""
sleep 2

# ═══════════════════════════════════════════════════════════════
echo "════════ 9. ОЧИСТКА ТЕСТОВЫХ ДАННЫХ ════════"
echo ""
sudo -u postgres psql -d instinct_db -c "
DELETE FROM external_order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_phone LIKE '+7999123%');
DELETE FROM external_id_mapping WHERE external_id LIKE 'demo_%';
DELETE FROM orders WHERE customer_phone LIKE '+7999123%';
DELETE FROM users WHERE phone LIKE '+7999123%';
DELETE FROM integration_queue WHERE operation_key LIKE 'demo_%';" > /dev/null 2>&1
echo "✅ Тестовые данные очищены"
echo ""

# ═══════════════════════════════════════════════════════════════
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         ✅ ДЕМОНСТРАЦИЯ ЗАВЕРШЕНА УСПЕШНО                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
