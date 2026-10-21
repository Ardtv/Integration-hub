require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const CdekClient = require('./cdek-client');
const HubClient = require('../shared/hub-client');
const { extractOrder } = require('./parsers/order-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.CDEK_WEBHOOK_PORT || 3003;
const CDEK_WEBHOOK_SECRET = process.env.CDEK_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!CDEK_WEBHOOK_SECRET) {
        console.warn('⚠️ CDEK_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== CDEK_WEBHOOK_SECRET) {
        console.warn(`🚫 Unauthorized webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/webhook/cdek', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от CDEK:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body;
        const orders = body.orders || (body.order ? [body.order] : []);

        if (orders.length === 0) {
            console.warn('⚠️ Нет заказов в вебхуке');
            return res.status(400).json({ error: 'No orders in payload' });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const cdekOrder of orders) {
            const event = extractOrder(cdekOrder);
            if (!event) {
                console.warn('⚠️ Не удалось извлечь заказ');
                failCount++;
                continue;
            }

            try {
                const result = await HubClient.sendWithRetry({
                    eventType: 'cdek.order.updated',
                    source: 'cdek',
                    payload: event,
                    operationKey: `cdek_${event.external_id}_${Date.now()}`
                });

                console.log(`✅ Отправлено в Hub:`, result);
                results.push({ external_id: event.external_id, hub: result });
                successCount++;
            } catch (e) {
                console.error(`❌ Ошибка:`, e.message);
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
        console.error('❌ Ошибка вебхука:', error);
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
