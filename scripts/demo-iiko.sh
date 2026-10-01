#!/bin/bash
cd ~/integration-hub

TOKEN=$(node -e "
require('dotenv').config({ quiet: true });
const axios = require('axios');
axios.post('https://api-ru.iiko.services/api/v2/access_token', {
    apiKey: process.env.IIKO_API_KEY,
    appId: process.env.IIKO_APP_ID,
    clientSecret: process.env.IIKO_CLIENT_SECRET
}).then(r => console.log(r.data.token));
" 2>/dev/null)

ORG="084cf002-ef41-4d35-88e5-8026413c05eb"
MENU_ID="93270"

echo "════════════════════════════════════════════════════════════"
echo " IIKO API — ДЕМОНСТРАЦИЯ ЗАПРОСОВ"
echo "════════════════════════════════════════════════════════════"
echo ""

# 1. АВТОРИЗАЦИЯ
echo "════════ 1. АВТОРИЗАЦИЯ ════════"
curl -s -X POST https://api-ru.iiko.services/api/v2/access_token \
  -H "Content-Type: application/json" \
  -d "{
    \"apiKey\": \"$(grep IIKO_API_KEY ~/integration-hub/.env | cut -d= -f2)\",
    \"appId\": \"$(grep IIKO_APP_ID ~/integration-hub/.env | cut -d= -f2)\",
    \"clientSecret\": \"$(grep IIKO_CLIENT_SECRET ~/integration-hub/.env | cut -d= -f2)\"
  }" | jq '{correlationId, token: (.token[0:40] + "...")}'
echo ""

# 2. ОРГАНИЗАЦИИ
echo "════════ 2. ОРГАНИЗАЦИИ ════════"
curl -s -X POST https://api-ru.iiko.services/api/1/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.organizations[] | {id, name, country, restaurantAddress}'
echo ""

# 3. ТЕРМИНАЛЫ
echo "════════ 3. ТЕРМИНАЛЫ ════════"
curl -s -X POST https://api-ru.iiko.services/api/1/terminal_groups \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationIds\": [\"$ORG\"]}" | jq '.terminalGroups[] | {organizationId, items: [.items[] | {id, name, posVersion}]}'
echo ""

# 4. ВНЕШНИЕ МЕНЮ
echo "════════ 4. ВНЕШНИЕ МЕНЮ ════════"
curl -s -X POST https://api-ru.iiko.services/api/2/menu \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\": \"$ORG\"}" | jq '.externalMenus'
echo ""

# 5. МЕНЮ — СТАТИСТИКА (79 товаров, 7 категорий)
echo "════════ 5. МЕНЮ — СТАТИСТИКА ════════"
curl -s -X POST https://api-ru.iiko.services/api/2/menu/by_id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationIds\": [\"$ORG\"], \"externalMenuId\": \"$MENU_ID\"}" \
  | jq '{
    id: .id,
    name: .name,
    revision: .revision,
    categoriesCount: (.itemCategories | length),
    itemsCount: ([.itemCategories[].items[]] | length),
    firstCategory: .itemCategories[0].name,
    firstItem: .itemCategories[0].items[0] | {sku, name, itemId}
  }'
echo ""

# 6. ПЕРВЫЕ 3 ТОВАРА С ЦЕНАМИ
echo "════════ 6. ПЕРВЫЕ 3 ТОВАРА С ЦЕНАМИ ════════"
curl -s -X POST https://api-ru.iiko.services/api/2/menu/by_id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationIds\": [\"$ORG\"], \"externalMenuId\": \"$MENU_ID\"}" \
  | jq '[.itemCategories[].items[] | {sku, name, price: .itemSizes[0].prices[0].price}] | .[0:3]'
echo ""

# 7. СТОП-ЛИСТ
echo "════════ 7. СТОП-ЛИСТ ════════"
curl -s -X POST https://api-ru.iiko.services/api/1/stop_lists \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationIds\": [\"$ORG\"]}" | jq '{stopListsCount: (.stopLists | length)}'
echo ""

# 8. ОСТАТКИ СКЛАДА
echo "════════ 8. ОСТАТКИ СКЛАДА ════════"
curl -s -X POST https://api-ru.iiko.services/api/inventory/v1/stock_balance/list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"organizationId\": \"$ORG\", \"balanceAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  | jq '{
    balanceAt,
    generatedAt,
    totalItems: (.items | length),
    positive: ([.items[] | select(.quantity > 0)] | length),
    negative: ([.items[] | select(.quantity < 0)] | length),
    zero: ([.items[] | select(.quantity == 0)] | length),
    firstFive: [.items[0:5][] | {productId, quantity}]
  }'
echo ""
