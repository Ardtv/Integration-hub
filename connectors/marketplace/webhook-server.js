require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const { extractOrder } = require('./parsers/order-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.MARKETPLACE_WEBHOOK_PORT || 3005;
const MARKETPLACE_WEBHOOK_SECRET = process.env.MARKETPLACE_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!MARKETPLACE_WEBHOOK_SECRET) {
        console.warn('⚠️ MARKETPLACE_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== MARKETPLACE_WEBHOOK_SECRET) {
        console.warn(`🚫 Unauthorized webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/webhook/ozon', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Ozon webhook:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body;
        const orders = body.orders || (body.order ? [body.order] : []);

        if (orders.length === 0) {
            return res.status(400).json({ error: 'No orders' });
        }

        for (const order of orders) {
            const event = extractOrder(order, 'ozon');
            if (!event) continue;

            try {
                await HubClient.sendWithRetry({
                    eventType: 'marketplace.order.updated',
                    source: 'ozon',
                    payload: event,
                    operationKey: `ozon_${event.external_id}_${Date.now()}`
                });
                console.log(`✅ Ozon order ${event.external_id} sent to Hub`);
            } catch (e) {
                console.error(`❌ Ozon order ${event.external_id} failed:`, e.message);
            }
        }

        res.status(200).json({ status: 'sent' });
    } catch (error) {
        console.error('❌ Ozon webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/webhook/wb', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 WB webhook:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body;
        const orders = body.orders || (body.order ? [body.order] : []);

        if (orders.length === 0) {
            return res.status(400).json({ error: 'No orders' });
        }

        for (const order of orders) {
            const event = extractOrder(order, 'wb');
            if (!event) continue;

            try {
                await HubClient.sendWithRetry({
                    eventType: 'marketplace.order.updated',
                    source: 'wb',
                    payload: event,
                    operationKey: `wb_${event.external_id}_${Date.now()}`
                });
                console.log(`✅ WB order ${event.external_id} sent to Hub`);
            } catch (e) {
                console.error(`❌ WB order ${event.external_id} failed:`, e.message);
            }
        }

        res.status(200).json({ status: 'sent' });
    } catch (error) {
        console.error('❌ WB webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/webhook/kaspi', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Kaspi webhook:', JSON.stringify(req.body).slice(0, 2000));

        const body = req.body;
        const orders = body.orders || (body.order ? [body.order] : []);

        if (orders.length === 0) {
            return res.status(400).json({ error: 'No orders' });
        }

        for (const order of orders) {
            const event = extractOrder(order, 'kaspi');
            if (!event) continue;

            try {
                await HubClient.sendWithRetry({
                    eventType: 'marketplace.order.updated',
                    source: 'kaspi',
                    payload: event,
                    operationKey: `kaspi_${event.external_id}_${Date.now()}`
                });
                console.log(`✅ Kaspi order ${event.external_id} sent to Hub`);
            } catch (e) {
                console.error(`❌ Kaspi order ${event.external_id} failed:`, e.message);
            }
        }

        res.status(200).json({ status: 'sent' });
    } catch (error) {
        console.error('❌ Kaspi webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'marketplace-connector' });
});

app.listen(PORT, () => {
    console.log(`🚀 Marketplace коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхуки: /webhook/ozon, /webhook/wb, /webhook/kaspi`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
