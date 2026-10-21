const STATUS_MAP = {
    new: 'new',
    confirmed: 'processing',
    paid: 'paid',
    assembled: 'ready',
    shipped: 'delivering',
    delivered: 'delivered',
    closed: 'completed',
    cancelled: 'cancelled'
};

function toMinor(value) {
    const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function normalizePhone(value) {
    if (!value) return null;
    const cleaned = String(value).replace(/[^\d+]/g, '');
    return cleaned || null;
}

function mapStatus(status) {
    if (!status) return undefined;
    const mapped = STATUS_MAP[String(status).toLowerCase()];
    if (!mapped) console.warn(`⚠️ 1C: неизвестный статус "${status}"`);
    return mapped;
}

function extractOrder(doc) {
    if (!doc) return null;
    const id = doc.id || doc.guid || doc.number;
    if (!id) return null;

    const customer = doc.customer || {};
    const items = Array.isArray(doc.items) ? doc.items : [];

    return {
        external_id: String(id),
        external_system: '1c',
        order: {
            customer_name: customer.name || 'Unknown',
            customer_phone: normalizePhone(customer.phone) || `unknown_1c_${id}`,
            delivery_address: doc.address || null,
            currency: doc.currency || 'RUB',
            total_amount_minor: toMinor(doc.sum),
            status: mapStatus(doc.status),
            comment: `1C ${doc.number || id}${doc.date ? ' от ' + doc.date : ''}`,
            items: items.map(item => ({
                external_id: item.code || item.sku || null,
                name: item.name || null,
                quantity: Number(item.quantity) || 1,
                price_minor: toMinor(item.price)
            }))
        }
    };
}

module.exports = { extractOrder, mapStatus, STATUS_MAP };
