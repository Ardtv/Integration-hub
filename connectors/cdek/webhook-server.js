require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const { extractOrder, extractStatusEvent } = require('./parsers/order-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.CDEK_WEBHOOK_PORT || 3003;
const SECRET = process.env.CDEK_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!SECRET) {
        console.warn('⚠️ CDEK_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== SECRET) {
        console.warn(`🚫 Unauthorized CDEK webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function collectEvents(body) {
    if (body.type === 'ORDER_STATUS') {
        const ev = extractStatusEvent(body);
        return ev ? [{ eventType: 'cdek.order.status_updated', data: ev }] : [null];
    }
    const orders = Array.isArray(body.orders) ? body.orders : (body.order ? [body.order] : []);
    return orders.map(o => {
        const ev = extractOrder(o);
        return ev ? { eventType: 'cdek.order.updated', data: ev } : null;
    });
}

app.post('/webhook/cdek', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от CDEK:', JSON.stringify(req.body).slice(0, 2000));

        const events = collectEvents(req.body || {});
        if (events.length === 0) {
            return res.status(400).json({ error: 'No orders in payload' });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const item of events) {
            if (!item) {
                console.warn('⚠️ CDEK: не удалось извлечь событие');
                failCount++;
                continue;
            }

            const { version, ...payload } = item.data;

            try {
                const result = await HubClient.sendWithRetry({
                    eventType: item.eventType,
                    source: 'cdek',
                    payload,
                    operationKey: `cdek_${payload.external_id}_${version}`
                });
                console.log(`✅ CDEK → Hub: ${item.eventType} ${payload.external_id}`, result);
                results.push({ external_id: payload.external_id, eventType: item.eventType, hub: result });
                successCount++;
            } catch (e) {
                console.error(`❌ CDEK → Hub: ${payload.external_id}:`, e.message);
                failCount++;
            }
        }

        const httpStatus = successCount === 0 && failCount > 0 ? 500 : 200;
        res.status(httpStatus).json({
            status: httpStatus === 200 ? 'sent' : 'failed',
            success: successCount,
            failed: failCount,
            results
        });
    } catch (error) {
        console.error('❌ Ошибка вебхука CDEK:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'cdek-connector' });
});

app.listen(PORT, () => {
    console.log(`🚀 CDEK коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхук URL: http://localhost:${PORT}/webhook/cdek`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
