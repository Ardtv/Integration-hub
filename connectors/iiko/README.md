# IIKO Connector

Интеграция с IIKO Cloud API (`https://api-ru.iiko.services`).

## Статус

| Компонент | Статус |
|-----------|--------|
| API-клиент (`iiko-client.js`) | ✅ Готов |
| Тест подключения (`test-connection.js`) | ✅ Готов |
| Скрипт запуска (`scripts/test-iiko.sh`) | ✅ Готов |
| Реальные доступы от заказчика | ✅ Получены  |
| ТЗ по синхронизации | ❌ Ожидаем |
| Вебхуки / синхронизация данных | ⏳ После ТЗ |

## Авторизация v2

IIKO использует **новую схему авторизации** — нужны **три параметра**:

| Параметр | Где взять | Формат |
|----------|-----------|--------|
| `apiKey` | iikoWeb → **Integrations → API Keys** | строка |
| `appId` | https://public-api.iikoweb.ru/portal → создать приложение | UUID |
| `clientSecret` | оттуда же (показывается **один раз**) | строка |
## У IIKO два API

| | iikoTransport (iikoCloud) | iikoWeb API (этот) |
|---|---|---|
| **Endpoint** | `/api/1/access_token` | `/api/v2/access_token` |
| **Параметры** | `apiLogin` (1) | `apiKey`, `appId`, `clientSecret` (3) |
| **Документация** | https://api-ru.iiko.services/docs | https://public-api.iikoweb.ru/portal |
| **Для** | Заказы, доставка, меню, терминалы | (шире) |
| **Не для** | Остатки склада, складские документы | — |

**Мы используем iikoWeb API (v2)**, потому что хаб подключается через него.
### Endpoint

```
POST https://api-ru.iiko.services/api/v2/access_token
Content-Type: application/json
```

### Запрос

```json
{
  "apiKey": "user-generated-api-key",
  "appId": "550e8400-e29b-41d4-a716-446655440000",
  "clientSecret": "sk_live_abc123def456..."
}
```

### Ответ (200)

```json
{
  "correlationId": "48fb4cd3-2ef6-4479-bea1-7c92721b988c",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Ошибки

| Код | Значение | Что делать |
|-----|----------|-----------|
| `400` | Bad Request | Проверить формат `appId` (UUID), заполнение полей |
| `401` | Unauthorized | Проверить `apiKey`, `clientSecret` |
| `408` | Request Timeout | Повторить запрос |
| `500` | Server Error | Обратиться в поддержку IIKO |

### Токен

- Живёт **1 час**
- Refresh token **нет** — при истечении запрашивать новый
- Передавать в заголовке: `Authorization: Bearer {token}`

## Переменные окружения

Добавить в `.env`:

```env
# IIKO (v2 auth: apiKey + appId + clientSecret)
IIKO_API_BASE=https://api-ru.iiko.services
IIKO_API_KEY=your-api-key-from-iikoweb
IIKO_APP_ID=your-app-uuid
IIKO_CLIENT_SECRET=your-client-secret
```

## Как получить доступы

### 1. `apiKey` — из iikoWeb

1. Войти в **iikoWeb** ресторана
2. Перейти в **Integrations** (или **Настройки → Интеграции**)
3. Выбрать **API Keys**
4. Сгенерировать **API-ключ**
5. Скопировать

**Важно:** `apiKey` определяет, **к каким ресторанам** токен даёт доступ.

### 2. `appId` и `clientSecret` — из Developer Portal

1. Открыть https://public-api.iikoweb.ru/portal
2. Зарегистрироваться (email + пароль)
3. Заполнить данные компании
4. Создать **приложение**
5. Получить:
   - **`appId`** — UUID приложения (не меняется)
   - **`clientSecret`** — показывается **один раз** (сохранить!)

**Важно:** `clientSecret` при утере восстанавливается в Developer Portal (старый отзывается).

## Тест подключения

### Через npm/скрипт

```bash
~/integration-hub/scripts/test-iiko.sh
```

### Напрямую

```bash
cd ~/integration-hub
node connectors/iiko/test-connection.js
```

### Что проверяет

1. **Наличие переменных** — `IIKO_API_KEY`, `IIKO_APP_ID`, `IIKO_CLIENT_SECRET`
2. **Формат `appId`** — должен быть UUID
3. **Получение токена** — `POST /api/v2/access_token`
4. **Список организаций** — `POST /api/1/organizations`

### Ожидаемый вывод (при успехе)

```
════════ IIKO API TEST ════════

▶ Тест 0: Проверка переменных
   IIKO_API_KEY: ✅
   IIKO_APP_ID: ✅
   IIKO_CLIENT_SECRET: ✅

▶ Тест 1: Получение токена
ℹ️ IIKO correlationId: 91b3a102-9cb8-4272-a1a8-82a8990a7038
✅ Токен получен: eyJhbGciOiJIUzI1NiIs...

▶ Тест 2: Список организаций
✅ Организаций: 1
   - Ресторан №1 (id: ...)

════════ DONE ════════
```

### Ожидаемый вывод (без доступов)

```
▶ Тест 0: Проверка переменных
   IIKO_API_KEY: ✅
   IIKO_APP_ID: ✅
   IIKO_CLIENT_SECRET: ✅

⚠️ IIKO_APP_ID не UUID. Ожидается формат:
   550e8400-e29b-41d4-a716-446655440000

▶ Тест 1: Получение токена
❌ Ошибка: Request failed with status code 400
   Body: {
     "correlationId": "...",
     "errorDescription": "Error converting value \"your-app-uuid\" to type 'System.Guid'...",
     "error": "INVALID_BODY_JSON_FORMAT"
   }
```

## Структура

```
connectors/iiko/
├── iiko-client.js       # API-клиент (getToken, getOrganizations)
├── test-connection.js   # Тест подключения
└── README.md            # Документ (этот файл)
```

## Что дальше

После получения **трёх параметров** от заказчика:

### 1. Заменить в `.env`

```env
IIKO_API_KEY=<реальное>
IIKO_APP_ID=<реальное-uuid>
IIKO_CLIENT_SECRET=<реальное>
```

### 2. Прогнать тест

```bash
~/integration-hub/scripts/test-iiko.sh
```

**Ожидаемо:** токен получен, организации видны.

### 3. Запросить ТЗ по синхронизации

**Вопросы заказчику:**

1. **Что синхронизировать?**
   - Заказы (создание/обновление)
   - Статусы доставки
   - Меню / номенклатура
   - Остатки

2. **Направление?**
   - IIKO → Hub (приём данных)
   - Hub → IIKO (отправка заказов)
   - Обе стороны

3. **Вебхуки?**
   - Умеет ли IIKO слать вебхуки?
   - Какие события?
   - Формат payload?

4. **Аккаунт?**
   - Production или Test?

5. **Маппинг полей?**
   - Какие поля IIKO → какие поля нашей БД

### 4. Реализовать

**Возможные компоненты:**
- `webhook-server.js` — если IIKO шлёт вебхуки
- `poller.js` — если нужно периодически опрашивать API
- `parsers/` — парсинг данных IIKO
- `case 'iiko'` в `event-handler.service.ts` — маршрутизация

## Полезные ссылки

- **Документация API:** https://api-ru.iiko.services/docs
- **Developer Portal:** https://public-api.iikoweb.ru/portal
- **iikoWeb:** https://ru.iiko.services/ (или личный домен ресторана)

## Отладка

### Логи

```bash
pm2 logs hub --lines 50
```

### Проверить переменные

```bash
grep "IIKO" ~/integration-hub/.env
```

### Проверить токен

```bash
IIKO_API_KEY=$(grep IIKO_API_KEY ~/integration-hub/.env | cut -d= -f2)
IIKO_APP_ID=$(grep IIKO_APP_ID ~/integration-hub/.env | cut -d= -f2)
IIKO_CLIENT_SECRET=$(grep IIKO_CLIENT_SECRET ~/integration-hub/.env | cut -d= -f2)

curl -s -X POST https://api-ru.iiko.services/api/v2/access_token \
  -H "Content-Type: application/json" \
  -d "{\"apiKey\":\"$IIKO_API_KEY\",\"appId\":\"$IIKO_APP_ID\",\"clientSecret\":\"$IIKO_CLIENT_SECRET\"}" \
  | jq '.'
```

## История изменений

| Дата | Что |
|------|-----|
| 21.09.2026 | Создан каркас, v2-авторизация, тест подключения |
| — | Ожидаем доступы от заказчика |
