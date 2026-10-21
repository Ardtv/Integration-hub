require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const express = require('express');
const HubClient = require('../shared/hub-client');
const { extractOrder } = require('./parsers/order-parser');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.MARKETPLACE_WEBHOOK_PORT || 3005;
const SECRET = process.env.MARKETPLACE_WEBHOOK_SECRET;
const PLATFORMS = ['ozon', 'wb', 'kaspi'];

function verifyWebhookSecret(req, res, next) {
    if (!SECRET) {
        console.warn('⚠️ MARKETPLACE_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== SECRET) {
        console.warn(`🚫 Unauthorized Marketplace webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

async function sendOne(platform, raw) {
    const event = extractOrder(raw, platform);
    if (!event) {
        console.warn(`⚠️ ${platform}: не удалось извлечь заказ`);
        return { ok: false };
    }
    const { version, ...payload } = event;
    try {
        const result = await HubClient.sendWithRetry({
            eventType: 'marketplace.order.updated',
            source: platform,
            payload,
            operationKey: `${payload.external_id}_${version}`
        });
        console.log(`✅ ${platform} → Hub: ${payload.external_id}`, result);
        return { ok: true, external_id: payload.external_id, hub: result };
    } catch (e) {
        console.error(`❌ ${platform} → Hub: ${payload.external_id}:`, e.message);
        return { ok: false, external_id: payload.external_id };
    }
}

function makeHandler(platform) {
    return async (req, res) => {
        try {
            console.log(`📨 ${platform} webhook:`, JSON.stringify(req.body).slice(0, 2000));
            const body = req.body || {};
            const orders = Array.isArray(body.orders) ? body.orders : (body.order ? [body.order] : []);
            if (orders.length === 0) return res.status(400).json({ error: 'No orders in payload' });

            const results = [];
            for (const raw of orders) results.push(await sendOne(platform, raw));
            const success = results.filter(r => r.ok).length;
            const failed = results.length - success;
            const httpStatus = success === 0 && failed > 0 ? 500 : 200;

            res.status(httpStatus).json({ status: httpStatus === 200 ? 'sent' : 'failed', success, failed, results });
        } catch (error) {
            console.error(`❌ ${platform} webhook error:`, error);
            res.status(500).json({ error: error.message });
        }
    };
}

for (const platform of PLATFORMS) {
    app.post(`/webhook/${platform}`, verifyWebhookSecret, makeHandler(platform));
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'marketplace-connector', platforms: PLATFORMS });
});

app.listen(PORT, () => {
    console.log(`🚀 Marketplace коннектор запущен на порту ${PORT}`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
