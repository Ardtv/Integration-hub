#!/usr/bin/env bash
# Ежедневная резервная копия базы хаба. Хранит локально BACKUP_KEEP_DAYS дней
# и, если задан BACKUP_REMOTE, отправляет копию за пределы сервера (rclone или scp).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a

DIR="${BACKUP_DIR:-/var/backups/integration-hub}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
FILE="$DIR/${DB_NAME}_$(date +%Y%m%d_%H%M%S).dump"
mkdir -p "$DIR"; chmod 700 "$DIR"

PGPASSWORD="${DB_PASSWORD}" pg_dump -Fc -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER}" "${DB_NAME}" > "$FILE"
[ -s "$FILE" ] || { echo "Копия пуста: $FILE" >&2; exit 1; }
find "$DIR" -name '*.dump' -mtime +"$KEEP" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
    case "$BACKUP_REMOTE" in
        *:*) if command -v rclone >/dev/null && rclone listremotes | grep -q "^${BACKUP_REMOTE%%:*}:$"; then
                 rclone copy "$FILE" "$BACKUP_REMOTE"
             else
                 scp -q "$FILE" "$BACKUP_REMOTE"
             fi ;;
        *)   echo "BACKUP_REMOTE должен быть вида remote:путь или user@host:путь" >&2; exit 1 ;;
    esac
else
    echo "ВНИМАНИЕ: BACKUP_REMOTE не задан, копия лежит только на этом сервере" >&2
fi
echo "$(date -Is) backup ok: $FILE"
