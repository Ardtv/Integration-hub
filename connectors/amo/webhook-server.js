// Приёмник вебхуков amoCRM. Сам ничего не решает: превращает вебхук в событие
// «сделка изменилась» и передаёт в хаб. Актуальные данные сделки хаб читает из amo сам.
require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const express = require('express');
const crypto = require('crypto');
const HubClient = require('../shared/hub-client');
const { requireSecret } = require('../shared/secret');
const { EVENTS } = require('../shared/events');

const KINDS = ['add', 'update', 'status', 'delete'];

function asArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : Object.values(v);
}

/**
 * Разбирает тело вебхука amoCRM.
 * amo присылает форму (leads[status][0][id]=…), express превращает её в объект leads.status[0].id.
 * Тот же формат в JSON тоже принимается.
 */
function extractEvents(body) {
    const out = [];
    const leads = body?.leads || {};
    for (const kind of KINDS) {
        for (const lead of asArray(leads[kind])) {
            const id = Number(lead?.id);
            if (!Number.isFinite(id) || id <= 0) continue;
            // Версия изменения: время правки из вебхука, иначе отпечаток содержимого.
            // Повторная доставка того же вебхука даёт тот же ключ, поэтому хаб отбросит дубль.
            const version = lead.updated_at || lead.last_modified
                || crypto.createHash('sha1').update(JSON.stringify(lead)).digest('hex').slice(0, 16);
            out.push({
                eventType: kind === 'delete' ? EVENTS.AMO_DEAL_DELETED : EVENTS.AMO_DEAL_CHANGED,
                source: 'amo',
                payload: { deal_id: id, kind },
                operationKey: `amo:${id}:${kind}:${lead.status_id || ''}:${version}`
            });
        }
    }
    return out;
}

function createApp(hub = HubClient) {
    const app = express();
    app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 10000 }));
    app.use(express.json({ limit: '2mb' }));

    app.post('/webhook/amo', requireSecret('AMO_WEBHOOK_SECRET'), async (req, res) => {
        const events = extractEvents(req.body);
        if (events.length === 0) return res.status(200).json({ status: 'ignored' });
        let failed = 0;
        for (const ev of events) {
            try {
                await hub.sendWithRetry(ev);
            } catch (e) {
                failed++;
                console.error(`amo → hub: сделка ${ev.payload.deal_id}: ${e.message}`);
            }
        }
        // Ошибка 5xx заставит amo повторить доставку: событие не потеряется.
        res.status(failed ? 502 : 200).json({ status: failed ? 'failed' : 'sent', events: events.length, failed });
    });

    app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'amo-connector' }));
    return app;
}

module.exports = { createApp, extractEvents };

if (require.main === module) {
    const port = process.env.AMO_WEBHOOK_PORT || 3002;
    createApp().listen(port, process.env.CONNECTOR_BIND || '127.0.0.1', () => console.log(`amo-коннектор слушает порт ${port}`));
}
