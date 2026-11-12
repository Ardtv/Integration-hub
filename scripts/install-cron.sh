#!/usr/bin/env bash
# Ставит cron-задачи хаба для текущего пользователя. Повторный запуск не создаёт дублей.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${HUB_LOG_DIR:-/var/log/integration-hub}"
mkdir -p "$LOG"
NODE="$(command -v node)"

BLOCK=$(cat <<CRON
# >>> integration-hub
*/5 * * * * $ROOT/scripts/healthcheck.sh >> $LOG/healthcheck.log 2>&1
*/10 * * * * cd $ROOT && $NODE connectors/cdek/poll-status.js >> $LOG/cdek-poll.log 2>&1
17 * * * * cd $ROOT && $NODE connectors/iiko/sync-menu.js >> $LOG/iiko-menu.log 2>&1
47 * * * * cd $ROOT && $NODE connectors/fulfillment/sync-stock.js >> $LOG/ff-stock.log 2>&1
30 3 * * * $ROOT/scripts/backup-db.sh >> $LOG/backup.log 2>&1
# <<< integration-hub
CRON
)
( crontab -l 2>/dev/null | sed '/# >>> integration-hub/,/# <<< integration-hub/d'; echo "$BLOCK" ) | crontab -
chmod +x "$ROOT"/scripts/*.sh
echo "Cron-задачи установлены. Журналы: $LOG"
