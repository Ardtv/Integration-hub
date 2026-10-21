function formatAddress(address) {
    if (!address) return null;
    return [address.city, address.street, address.house, address.flat]
        .filter(Boolean)
        .join(', ') || null;
}

function mapStatus(status) {
    const MAP = {
        'awaiting_packaging': 'pending_payment',
        'awaiting_deliver': 'processing',
        'delivering': 'delivering',
        'delivered': 'delivered',
        'cancelled': 'cancelled'
    };
    return MAP[status] || 'new';
}

function extractOrder(marketplaceOrder, platform) {
    if (!marketplaceOrder || !marketplaceOrder.posting_number) return null;

    return {
        external_id: `${platform}_${marketplaceOrder.posting_number}`,
        external_system: platform,
        order: {
            customer_name: marketplaceOrder.customer?.name || 'Unknown',
            customer_phone: marketplaceOrder.customer?.phone || `unknown_${marketplaceOrder.posting_number}`,
            delivery_address: formatAddress(marketplaceOrder.delivery_address),
            currency: 'RUB',
            total_amount_minor: Math.round((marketplaceOrder.total_price || 0) * 100),
            status: mapStatus(marketplaceOrder.status),
            comment: `${platform} order ${marketplaceOrder.posting_number}`,
            items: (marketplaceOrder.products || []).map(item => ({
                external_id: item.sku || null,
                name: item.name || null,
                quantity: item.quantity || 1,
                price_minor: Math.round((item.price || 0) * 100)
            }))
        }
    };
}

module.exports = { extractOrder };
