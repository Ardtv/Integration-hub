require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const MoyskladClient = require('./moysklad-client');
const { extractProduct, idFromHref } = require('./parsers/product-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.MOYSKLAD_WEBHOOK_PORT || 3007;
const SECRET = process.env.MOYSKLAD_WEBHOOK_SECRET;

const ACTION_TO_EVENT = {
    CREATE: 'moysklad.product.created',
    UPDATE: 'moysklad.product.updated',
    DELETE: 'moysklad.product.deleted'
};

function verifyWebhookSecret(req, res, next) {
    if (!SECRET) {
        console.warn('⚠️ MOYSKLAD_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== SECRET) {
        console.warn(`🚫 Unauthorized МойСклад webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

async function buildPayload(ev, action, id) {
    if (action === 'DELETE') {
        return { external_id: id, external_system: 'moysklad', product: { deleted: true } };
    }
    const entity = ev.entity || await MoyskladClient.getByHref(ev.meta.href);
    return extractProduct(entity);
}

app.post('/webhook/moysklad', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от МойСклад:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body || {};
        const events = Array.isArray(body.events) ? body.events : [];

        if (events.length === 0) {
            return res.status(400).json({ error: 'No events in payload' });
        }

        const moment = body.auditContext?.moment || Date.now();
        const results = [];
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;

        for (const ev of events) {
            const type = ev.meta?.type;
            const action = String(ev.action || '').toUpperCase();
            const eventType = ACTION_TO_EVENT[action];
            const id = idFromHref(ev.meta?.href);

            if (type !== 'product' || !eventType || !id) {
                skipCount++;
                continue;
            }

            try {
                const payload = await buildPayload(ev, action, id);
                if (!payload) {
                    failCount++;
                    continue;
                }

                const result = await HubClient.sendWithRetry({
                    eventType,
                    source: 'moysklad',
                    payload,
                    operationKey: `moysklad_${id}_${action}_${moment}`
                });
                console.log(`✅ МойСклад → Hub: ${eventType} ${id}`, result);
                results.push({ external_id: id, eventType, hub: result });
                successCount++;
            } catch (e) {
                console.error(`❌ МойСклад → Hub: ${id}:`, e.message);
                failCount++;
            }
        }

        const httpStatus = successCount === 0 && failCount > 0 ? 500 : 200;
        res.status(httpStatus).json({
            status: httpStatus === 200 ? 'sent' : 'failed',
            success: successCount,
            failed: failCount,
            skipped: skipCount,
            results
        });
    } catch (error) {
        console.error('❌ Ошибка вебхука МойСклад:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'moysklad-connector' });
});

app.listen(PORT, () => {
    console.log(`🚀 МойСклад коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхук URL: http://localhost:${PORT}/webhook/moysklad`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
