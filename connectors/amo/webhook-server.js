const express = require('express');
const dotenv = require('dotenv');
const HubClient = require('../shared/hub-client');
const AmoClient = require('./amo-client');

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));

const AMO_API_DOMAIN = process.env.AMO_API_DOMAIN;
const AMO_API_TOKEN = process.env.AMO_API_TOKEN;
const amoClient = (AMO_API_DOMAIN && AMO_API_TOKEN)
    ? new AmoClient(AMO_API_TOKEN, AMO_API_DOMAIN)
    : null;

console.log(`🔧 AmoClient init: domain=${AMO_API_DOMAIN}, hasToken=${!!AMO_API_TOKEN}`);
if (!amoClient) {
    console.warn('⚠️ AMO_API_DOMAIN или AMO_API_TOKEN не заданы — дозапрос через API недоступен');
}

async function enrichFromApi(dealId) {
    if (!amoClient) return null;

    try {
        const deal = await amoClient.getDeal(dealId);
        const contactId = deal?._embedded?.contacts?.[0]?.id;
        const contact = contactId ? await amoClient.getContact(contactId) : null;
        const products = await amoClient.getDealProducts(dealId).catch(() => []);

        return { deal, contact, products };
    } catch (e) {
        console.error(`❌ enrichFromApi(${dealId}) failed:`, e.message);
        return null;
    }
}

function mergeEnriched(order, enriched) {
    const { contact, products } = enriched;

    if (contact) {
        const contactName = contact.name;
        if (contactName && (order.customer_name === 'Unknown' || !order.customer_name)) {
            order.customer_name = String(contactName);
        }

        const phone = getCustomField(contact, 'PHONE');
        if (phone && (!order.customer_phone || order.customer_phone.startsWith('unknown_'))) {
            order.customer_phone = normalizePhone(phone);
        }

        const email = getCustomField(contact, 'EMAIL');
        if (email && !order.customer_email) {
            order.customer_email = email;
        }

        const address = getCustomField(contact, 'ADDRESS');
        if (address && !order.delivery_address) {
            order.delivery_address = address;
        }
    }

    if (Array.isArray(products) && products.length > 0 && order.items.length === 0) {
        order.items = products.map(p => ({
            external_id: p.id ? String(p.id) : null,
            name: p.name || null,
            quantity: Number(p.quantity) || 1,
            price_minor: Math.round((Number(p.price) || 0) * 100)
        }));
    }

    return order;
}

function getCustomField(entity, code) {
    if (!entity || !entity.custom_fields_values) return null;
    const field = entity.custom_fields_values.find(f => f.field_code === code);
    if (!field || !field.values || field.values.length === 0) return null;
    return field.values[0].value || null;
}

function normalizePhone(value) {
    if (!value) return value;
    const cleaned = String(value).replace(/[^\d+]/g, '');
    return cleaned || value;
}

function mapStatus(statusId) {
    const MAP = {
        142: 'new',
        143: 'pending_payment',
        144: 'paid',
        145: 'cancelled',
    };
    const key = Number(statusId);
    return MAP[key] || 'new';
}

function extractOrder(dealData, useFallback = true) {
    if (!dealData || !dealData.id) return null;

    const contacts = dealData._embedded?.contacts;
    const contact = Array.isArray(contacts) && contacts.length > 0
        ? contacts[0]
        : null;

    const contactName = contact ? contact.name : null;
const rawName = contactName || dealData.name;
const customerName = rawName
    ? String(rawName)
    : (useFallback ? 'Unknown' : null);

    const phoneFromContact = getCustomField(contact, 'PHONE');
    const phoneFromLead = getCustomField(dealData, 'PHONE');
    const phoneRaw = phoneFromContact || phoneFromLead;
    const customerPhone = phoneRaw
        ? normalizePhone(phoneRaw)
        : (useFallback ? `unknown_${dealData.id}` : null);

    const emailFromContact = getCustomField(contact, 'EMAIL');
    const emailFromLead = getCustomField(dealData, 'EMAIL');
    const customerEmail = emailFromContact || emailFromLead || null;

    const addressFromContact = getCustomField(contact, 'ADDRESS');
    const addressFromLead = getCustomField(dealData, 'ADDRESS');
    const deliveryAddress = addressFromContact || addressFromLead || null;

    const rawItems = dealData._embedded?.catalog_elements
        || dealData._embedded?.items
        || [];

    const items = rawItems.map(it => ({
        external_id: it.id ? String(it.id) : null,
        name: it.name || it.product_name || null,
        quantity: Number(it.quantity) || 1,
        price_minor: Math.round((Number(it.price) || 0) * 100)
    }));

    const priceRub = Number(dealData.price) || 0;
    const totalAmountMinor = Math.round(priceRub * 100);

    return {
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        delivery_address: deliveryAddress,
        currency: 'RUB',
        total_amount_minor: totalAmountMinor,
        status: mapStatus(dealData.status_id),
comment: dealData.name ? String(dealData.name) : `amoCRM lead ${dealData.id}`,
        items
    };
}

function detectEvents(body) {
    const events = [];

    if (body.leads) {
        if (body.leads.add) {
            for (const lead of body.leads.add) {
                events.push({ type: 'deal.created', lead });
            }
        }
        if (body.leads.update) {
            for (const lead of body.leads.update) {
                events.push({ type: 'deal.updated', lead });
            }
        }
        if (body.leads.status) {
            for (const lead of body.leads.status) {
                events.push({ type: 'deal.status_updated', lead });
            }
        }
        if (body.leads.delete) {
            for (const lead of body.leads.delete) {
                events.push({ type: 'deal.deleted', lead });
            }
        }
    

        if (events.length === 0) {
            const keys = Object.keys(body.leads);
            console.warn(`⚠️ leads присутствует, но без известных ключей: ${keys.join(', ') || '(пусто)'}`);
        }
    }

    if (events.length === 0 && body._embedded?.leads) {
        for (const lead of body._embedded.leads) {
            events.push({ type: 'deal.created', lead });
        }
    }

    if (events.length === 0) {
        const keys = Object.keys(body);
        console.warn(`⚠️ Неизвестный формат вебхука, ключи: ${keys.join(', ') || '(пусто)'}`);
    }

    return events;
}
const AMO_WEBHOOK_SECRET = process.env.AMO_WEBHOOK_SECRET;

function verifyWebhookSecret(req, res, next) {
    if (!AMO_WEBHOOK_SECRET) {
        console.warn('⚠️ AMO_WEBHOOK_SECRET не задан — пропускаю проверку');
        return next();
    }
    const token = req.headers['x-webhook-secret'] || req.query.secret;
    if (token !== AMO_WEBHOOK_SECRET) {
        console.warn(`🚫 Unauthorized webhook from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/webhook/amo', verifyWebhookSecret, async (req, res) => {
    try {
        console.log('📨 Получен вебхук от AmoCRM:', JSON.stringify(req.body).slice(0, 2000));

        const events = detectEvents(req.body);
        if (events.length === 0) {
            console.warn('⚠️ В вебхуке нет событий');
            return res.status(400).json({ error: 'No events in payload' });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const { type, lead } of events) {
            if (!lead || !lead.id) {
                console.warn(`⚠️ Пропускаю событие без lead.id (type=${type})`);
                failCount++;
                continue;
            }

            const useFallback = type === 'deal.created';
            const order = extractOrder(lead, useFallback);
            if (!order) {
                console.warn(`⚠️ Не удалось извлечь заказ из lead ${lead.id}`);
                failCount++;
                continue;
            }

            console.log(`📦 [${type}] Извлечён заказ:`, JSON.stringify(order));

            const eventData = {
                eventType: type,
                source: 'amo',
                payload: {
                    order,
                    external_id: String(lead.id),
                    external_system: 'amo'
                },
                operationKey: `amo_${lead.id}_${type}_${Date.now()}`
            };

            try {
                const result = await HubClient.sendWithRetry(eventData);
                console.log(`✅ [${type}] Отправлено в Хаб:`, result);
                results.push({ type, dealId: lead.id, hub: result });
                successCount++;
            } catch (sendError) {
                console.error(`❌ [${type}] Не удалось отправить в Хаб:`, sendError.message);
                results.push({ type, dealId: lead.id, error: sendError.message });
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
    res.json({ status: 'ok', service: 'amo-connector' });
});

app.post('/webhook/iiko', async (req, res) => {
    const IIKO_SECRET = process.env.IIKO_WEBHOOK_SECRET;

    if (IIKO_SECRET) {
        const token = req.headers['x-webhook-token'] || req.query.token;
        if (token !== IIKO_SECRET) {
            console.warn(`🚫 IIKO Unauthorized webhook from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    console.log('📨 Получен вебхук от IIKO:', JSON.stringify(req.body).slice(0, 2000));

    try {
        const result = await HubClient.sendWithRetry({
            eventType: 'iiko.event',
            source: 'iiko',
            payload: req.body,
            operationKey: `iiko_${Date.now()}_${Math.random().toString(36).slice(2)}`
        });
        res.status(200).json({ status: 'accepted', hub: result });
    } catch (e) {
        console.error('❌ Ошибка отправки в Hub:', e.message);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.AMO_WEBHOOK_PORT || 3002;
app.listen(PORT, () => {
    console.log(`🚀 AmoCRM коннектор запущен на порту ${PORT}`);
    console.log(`📡 Вебхук URL: http://localhost:${PORT}/webhook/amo`);
    console.log(`🔗 Хаб URL: ${process.env.HUB_URL || 'http://localhost:3001'}`);
});
