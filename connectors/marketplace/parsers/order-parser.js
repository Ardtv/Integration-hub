const STATUS_MAP = {
    awaiting_packaging: 'pending_payment',
    awaiting_deliver: 'processing',
    delivering: 'delivering',
    delivered: 'delivered',
    cancelled: 'cancelled'
};

function mapStatus(status) {
    if (!status) return undefined;
    const mapped = STATUS_MAP[String(status).toLowerCase()];
    if (!mapped) console.warn(`⚠️ Marketplace: неизвестный статус "${status}"`);
    return mapped;
}

function formatAddress(address) {
    if (!address) return null;
    if (typeof address === 'string') return address;
    return [address.city, address.street, address.house, address.flat]
        .filter(Boolean)
        .join(', ') || null;
}

function extractOrder(marketplaceOrder, platform) {
    if (!marketplaceOrder || !marketplaceOrder.posting_number) return null;
    const num = marketplaceOrder.posting_number;

    return {
        external_id: `${platform}_${num}`,
        external_system: platform,
        version: marketplaceOrder.updated_at || marketplaceOrder.status || 'na',
        order: {
            customer_name: marketplaceOrder.customer?.name || 'Unknown',
            customer_phone: marketplaceOrder.customer?.phone || `unknown_${platform}_${num}`,
            delivery_address: formatAddress(marketplaceOrder.delivery_address),
            currency: 'RUB',
            total_amount_minor: Math.round((marketplaceOrder.total_price || 0) * 100),
            status: mapStatus(marketplaceOrder.status),
            comment: `${platform} order ${num}`,
            items: (marketplaceOrder.products || []).map(item => ({
                external_id: item.sku ? String(item.sku) : null,
                name: item.name || null,
                quantity: item.quantity || 1,
                price_minor: Math.round((item.price || 0) * 100)
            }))
        }
    };
}

module.exports = { extractOrder, mapStatus, STATUS_MAP };
