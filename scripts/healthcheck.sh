#!/usr/bin/env bash
# Проверяет процессы и очередь. При проблеме шлёт алерт в Telegram (если настроен) и выходит с кодом 1.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

problems=()
check() { curl -fsS -m 5 "http://127.0.0.1:$2/health" >/dev/null 2>&1 || problems+=("$1 не отвечает на порту $2"); }
check "Хаб" "${HUB_PORT:-3001}"
check "amo-коннектор" "${AMO_WEBHOOK_PORT:-3002}"
check "cdek-коннектор" "${CDEK_WEBHOOK_PORT:-3003}"

stats=$(curl -fsS -m 5 -H "X-Api-Token: ${HUB_API_TOKEN:-}" "http://127.0.0.1:${HUB_PORT:-3001}/api/admin/stats" 2>/dev/null || true)
dead=$(printf '%s' "$stats" | sed -n 's/.*"dead":\([0-9]*\).*/\1/p')
pending=$(printf '%s' "$stats" | sed -n 's/.*"pending":\([0-9]*\).*/\1/p')
[ -n "$dead" ] && [ "$dead" -gt "${ALERT_DEAD_THRESHOLD:-0}" ] && problems+=("В очереди необработанных событий: $dead")
[ -n "$pending" ] && [ "$pending" -gt "${ALERT_PENDING_THRESHOLD:-200}" ] && problems+=("Очередь растёт: ожидает $pending событий")

if [ ${#problems[@]} -eq 0 ]; then echo "$(date -Is) ok ${stats}"; exit 0; fi

text="Integration Hub: $(printf '%s; ' "${problems[@]}")"
echo "$(date -Is) $text" >&2
if [ -n "${ALERT_TG_BOT_TOKEN:-}" ] && [ -n "${ALERT_TG_CHAT_ID:-}" ]; then
    curl -fsS -m 8 "https://api.telegram.org/bot${ALERT_TG_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" --data-urlencode "text=${text}" >/dev/null 2>&1 || true
fi
exit 1
