function formatAddress(address) {
    if (!address) return null;
    return [address.city, address.street, address.house, address.flat]
        .filter(Boolean)
        .join(', ') || null;
}

function mapStatus(code) {
    const MAP = {
        'CREATED': 'new',
        'ACCEPTED': 'processing',
        'DELIVERED': 'delivered',
        'CANCELLED': 'cancelled',
        'REFUSED': 'cancelled'
    };
    return MAP[code] || 'new';
}

function extractOrder(cdekOrder) {
    if (!cdekOrder || !cdekOrder.uuid) return null;

    return {
        external_id: cdekOrder.uuid,
        external_system: 'cdek',
        order: {
            customer_name: cdekOrder.recipient?.name || 'Unknown',
            customer_phone: cdekOrder.recipient?.phones?.[0]?.number || `unknown_${cdekOrder.uuid}`,
            delivery_address: formatAddress(cdekOrder.recipient?.address),
            currency: 'RUB',
            total_amount_minor: Math.round((cdekOrder.delivery_sum || 0) * 100),
            status: mapStatus(cdekOrder.statuses?.[0]?.code),
            comment: `CDEK order ${cdekOrder.cdek_number || cdekOrder.uuid}`,
            items: (cdekOrder.items || []).map(item => ({
                external_id: item.uuid || null,
                name: item.name || null,
                quantity: item.amount || 1,
                price_minor: Math.round((item.price || 0) * 100)
            }))
        }
    };
}

module.exports = { extractOrder };
