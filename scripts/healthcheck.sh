#!/bin/bash

echo "════════ HEALTHCHECK $(date '+%Y-%m-%d %H:%M:%S') ════════"
echo ""

echo "── Hub (:3001) ──"
if curl -s -f http://localhost:3001/health > /dev/null; then
    echo "✅ Hub OK"
    curl -s http://localhost:3001/health
    echo ""
else
    echo "❌ Hub недоступен"
fi
echo ""

echo "── amo-connector (:3002) ──"
if curl -s -f http://localhost:3002/health > /dev/null; then
    echo "✅ amo-connector OK"
    curl -s http://localhost:3002/health
    echo ""
else
    echo "❌ amo-connector недоступен"
fi
echo ""

echo "── PostgreSQL ──"
if sudo -u postgres psql -d instinct_db -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ БД OK"
else
    echo "❌ БД недоступна"
fi
echo ""

echo "── Очередь (по статусам) ──"
sudo -u postgres psql -d instinct_db -c "
SELECT status, COUNT(*) AS cnt
FROM integration_queue
GROUP BY status
ORDER BY status;"
echo ""

echo "── Последние 5 ошибок ──"
sudo -u postgres psql -d instinct_db -c "
SELECT id, event_type, LEFT(error_message, 60) AS error
FROM integration_queue
WHERE error_message IS NOT NULL
ORDER BY id DESC
LIMIT 5;"
echo ""

echo "── Последние 5 заказов ──"
sudo -u postgres psql -d instinct_db -c "
SELECT id, customer_name, customer_phone, total_amount_minor, status
FROM orders
ORDER BY id DESC
LIMIT 5;"
echo ""

echo "════════ DONE ════════"
