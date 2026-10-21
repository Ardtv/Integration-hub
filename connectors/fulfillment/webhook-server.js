require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const { extractShipment } = require('./parsers/shipment-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.FULFILLMENT_WEBHOOK_PORT || 3004;
const FULFILLMENT_WEBHOOK_SECRET = process.env.FULFILLMENT_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!FULFILLMENT_WEBHOOK_SECRET) {
        console.warn('⚠️ FULFILLMENT_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== FULFILLMENT_WEBHOOK_SECRET) {
        console.warn(`🚫 Unauthorized webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/webhook/fulfillment', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от Fulfillment:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body;
        const shipments = body.shipments || (body.shipment ? [body.shipment] : []);

        if (shipments.length === 0) {
            console.warn('⚠️ Нет shipments в вебхуке');
            return res.status(400).json({ error: 'No shipments in payload' });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const shipment of shipments) {
            const event = extractShipment(shipment);
            if (!event) {
                console.warn('⚠️ Не удалось извлечь shipment');
                failCount++;
                continue;
            }

            try {
                const result = await HubClient.sendWithRetry({
                    eventType: 'fulfillment.shipment.updated',
                    source: 'fulfillment',
                    payload: event,
                    operationKey: `fulfillment_${event.external_id}_${Date.now()}`
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
    res.json({ status: 'ok', service: 'fulfillment-connector' });
});

app.listen(PORT, () => {
    console.log(`🚀 Fulfillment коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхук URL: http://localhost:${PORT}/webhook/fulfillment`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
