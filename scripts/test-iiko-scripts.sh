#!/bin/bash
cd ~/integration-hub

echo "════════ IIKO SCRIPTS TEST ════════"
echo ""

echo "▶ sync-menu.js"
node connectors/iiko/sync-menu.js
echo ""

echo "▶ sync-status.js"
node connectors/iiko/sync-status.js
echo ""

echo "▶ send-order.js (load)"
node -e "require('./connectors/iiko/send-order'); console.log('✅ module loaded')"
echo ""

echo "════════ DONE ════════"
