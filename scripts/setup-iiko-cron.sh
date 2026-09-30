#!/bin/bash
cd ~/integration-hub

if crontab -l 2>/dev/null | grep -q "iiko-sync"; then
    echo "ℹ️ Cron уже настроен:"
    crontab -l | grep iiko
    exit 0
fi

(crontab -l 2>/dev/null; \
echo "# IIKO sync"; \
echo "15 * * * * cd /root/integration-hub && node connectors/iiko/sync-menu.js >> /var/log/iiko-sync-menu.log 2>&1"; \
echo "5 * * * * cd /root/integration-hub && node connectors/iiko/sync-status.js >> /var/log/iiko-sync-status.log 2>&1") | crontab -

echo "✅ Cron добавлен:"
crontab -l | grep iiko
