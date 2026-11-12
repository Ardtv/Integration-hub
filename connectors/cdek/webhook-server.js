// Приёмник вебхуков СДЭК (тип ORDER_STATUS). Передаёт статус заказа в хаб.
require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const express = require('express');
const HubClient = require('../shared/hub-client');
const { requireSecret } = require('../shared/secret');
const { EVENTS } = require('../shared/events');

/** Вебхук СДЭК → событие хаба. null, если это не статус заказа. */
function toEvent(body) {
    if (!body || body.type !== 'ORDER_STATUS' || !body.uuid) return null;
    const a = body.attributes || {};
    const code = a.code || a.status_code;
    if (!code) return null;
    const statusAt = a.status_date_time || body.date_time || null;
    return {
        eventType: EVENTS.CDEK_ORDER_STATUS,
        source: 'cdek',
        payload: { cdek_uuid: String(body.uuid), cdek_number: a.cdek_number ? String(a.cdek_number) : null, code: String(code), status_at: statusAt },
        operationKey: `cdek:${body.uuid}:${code}:${statusAt || 'na'}`
    };
}

/** Заказ из GET /orders/{uuid} → события по каждому статусу (для запасного опроса). */
function eventsFromOrder(entity) {
    if (!entity?.uuid) return [];
    return (entity.statuses || []).slice().reverse().map(st => ({
        eventType: EVENTS.CDEK_ORDER_STATUS,
        source: 'cdek',
        payload: { cdek_uuid: String(entity.uuid), cdek_number: entity.cdek_number ? String(entity.cdek_number) : null, code: String(st.code), status_at: st.date_time || null },
        operationKey: `cdek:${entity.uuid}:${st.code}:${st.date_time || 'na'}`
    }));
}

function createApp(hub = HubClient) {
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    app.post('/webhook/cdek', requireSecret('CDEK_WEBHOOK_SECRET'), async (req, res) => {
        const ev = toEvent(req.body);
        if (!ev) return res.status(200).json({ status: 'ignored' });
        try {
            const r = await hub.sendWithRetry(ev);
            res.json({ status: 'sent', hub: r });
        } catch (e) {
            console.error(`cdek → hub: ${ev.payload.cdek_uuid}: ${e.message}`);
            res.status(502).json({ status: 'failed' });
        }
    });

    app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cdek-connector' }));
    return app;
}

module.exports = { createApp, toEvent, eventsFromOrder };

if (require.main === module) {
    const port = process.env.CDEK_WEBHOOK_PORT || 3003;
    createApp().listen(port, process.env.CONNECTOR_BIND || '127.0.0.1', () => console.log(`cdek-коннектор слушает порт ${port}`));
}
