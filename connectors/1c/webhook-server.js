require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const { extractOrder } = require('./parsers/order-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.API_1C_WEBHOOK_PORT || 3006;
const SECRET = process.env.API_1C_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!SECRET) {
        console.warn('⚠️ API_1C_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== SECRET) {
        console.warn(`🚫 Unauthorized 1C webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/webhook/1c', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от 1С:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body || {};
        const docs = Array.isArray(body.orders) ? body.orders : (body.order ? [body.order] : []);

        if (docs.length === 0) {
            return res.status(400).json({ error: 'No orders in payload' });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const doc of docs) {
            const event = extractOrder(doc);
            if (!event) {
                console.warn('⚠️ 1С: не удалось извлечь заказ');
                failCount++;
                continue;
            }

            try {
                const version = doc.version || doc.updated_at || Date.now();
                const result = await HubClient.sendWithRetry({
                    eventType: '1c.order.updated',
                    source: '1c',
                    payload: event,
                    operationKey: `1c_${event.external_id}_${version}`
                });
                console.log(`✅ 1С → Hub: ${event.external_id}`, result);
                results.push({ external_id: event.external_id, hub: result });
                successCount++;
            } catch (e) {
                console.error(`❌ 1С → Hub: ${event.external_id}:`, e.message);
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
        console.error('❌ Ошибка вебхука 1С:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: '1c-connector' });
});

app.listen(PORT, () => {
    console.log(`🚀 1С коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхук URL: http://localhost:${PORT}/webhook/1c`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
