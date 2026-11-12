# Установка и обновление

Сервер: Ubuntu 24.04, Node.js 20+, PostgreSQL, nginx с HTTPS, pm2. Хаб может жить на одном сервере с мини-аппой, но в своей базе.

## 1. База

```bash
sudo -u postgres psql -c "CREATE USER hub_user WITH PASSWORD '<пароль>';"
sudo -u postgres psql -c "CREATE DATABASE instinct_db OWNER hub_user;"
```

## 2. Код

```bash
sudo mkdir -p /opt/integration-hub && sudo chown "$USER" /opt/integration-hub
git clone https://github.com/Ardtv/Integration-hub.git /opt/integration-hub
cd /opt/integration-hub
npm ci
cp .env.example .env && chmod 600 .env
nano .env
npm run build
npm run migrate
```

Что заполнить в `.env` сразу: `DB_*`, `HUB_API_TOKEN`, `AMO_WEBHOOK_SECRET`, `CDEK_WEBHOOK_SECRET` (случайные строки, например `openssl rand -hex 24`), ключи amo, СДЭК, IIKO и 1С. `HUB_MODE` оставьте `test`.

## 3. amoCRM: поля и этапы

```bash
npm run amo:discover                         # посмотреть воронки и их ID
npm run amo:setup -- --pipeline <id>         # что будет создано
npm run amo:setup -- --pipeline <id> --apply # создать поля и этапы
```

Скрипт печатает строки `AMO_*` для `.env`. Порядок новых этапов в воронке поправьте мышкой в amo. Этап для возвратов (`AMO_STAGE_RETURN`) необязателен: создайте его вручную, если нужен.

## 4. Процессы

```bash
pm2 start ecosystem.config.js
pm2 save && pm2 startup     # автозапуск после перезагрузки
./scripts/install-cron.sh   # проверки, опрос СДЭК, справочники, резервные копии
```

## 5. nginx

Вставьте содержимое `deploy/nginx-hub.conf` в блок `server` домена и перезагрузите nginx: `sudo nginx -t && sudo systemctl reload nginx`.

## 6. Вебхуки

- **amoCRM:** Настройки → Интеграции → Вебхуки. Адрес `https://<домен>/webhook/amo?secret=<AMO_WEBHOOK_SECRET>`, события: сделка добавлена, изменена, смена статуса, удалена.
- **СДЭК:** `node scripts/cdek-subscribe.js "https://<домен>/webhook/cdek?secret=<CDEK_WEBHOOK_SECRET>"`.

## 7. Справочник товаров

```bash
node connectors/iiko/sync-menu.js        # товары IIKO
node connectors/fulfillment/sync-stock.js # товары и остатки фулфилмента
npm run products:suggest                  # предложения по совпадению названий
npm run products:suggest -- --apply
```

Товары amo попадают в справочник при первой сделке с ними. Остальное (единицы IIKO, вес, карточки 1С) заполняется в панели на вкладке «Товары».

## 8. Проверка в тестовом режиме

1. Откройте `https://<домен>/hub/panel`, введите `HUB_API_TOKEN`.
2. Заполните в тестовой сделке поля отправки и переведите её на «Передать в доставку».
3. На вкладке «Исходящие вызовы» появится заявка в СДЭК со статусом `dry_run`. Проверьте тело запроса.
4. Продолжить цепочку без СДЭК можно событием статуса:

```bash
curl -X POST http://127.0.0.1:3001/api/events -H "X-Api-Token: $HUB_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"eventType":"cdek.order.status","source":"manual","operationKey":"manual-1","payload":{"cdek_uuid":"dry-<ID сделки>","code":"RECEIVED_AT_SHIPMENT_WAREHOUSE","cdek_number":"TEST-1"}}'
```

## 9. Включение боевого режима

Включайте по одному звену и проверяйте каждое на одной реальной сделке.

1. СДЭК: сначала тестовый контур (`CDEK_API_BASE=https://api.edu.cdek.ru/v2` с тестовыми ключами), затем боевой адрес и ключи.
2. В `.env`: `HUB_MODE=live` и `HUB_LIVE_CONFIRM=yes`. `IIKO_WRITEOFF_ENABLED` и `API_1C_ENABLED` пока `false`: документы будут помечаться пропущенными, а менеджер получит задачу.
3. `pm2 restart all --update-env`.
4. Когда заявки в СДЭК идут правильно, включите `IIKO_WRITEOFF_ENABLED=true`, затем `API_1C_ENABLED=true`. Пропущенные документы можно создать из карточки сделки в панели.

## Обновление

```bash
cd /opt/integration-hub
./scripts/backup-db.sh
git pull
npm ci && npm run build && npm run migrate
pm2 restart all --update-env
./scripts/healthcheck.sh
```

## Журналы

- `pm2 logs hub`, `pm2 logs amo-connector`, `pm2 logs cdek-connector`
- cron: `/var/log/integration-hub/`
