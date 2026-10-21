const STATUS_MAP = {
    pending: 'pending_payment',
    assembling: 'processing',
    ready: 'ready',
    shipped: 'delivering',
    delivered: 'delivered',
    cancelled: 'cancelled'
};

function mapStatus(status) {
    if (!status) return undefined;
    const mapped = STATUS_MAP[String(status).toLowerCase()];
    if (!mapped) console.warn(`⚠️ Fulfillment: неизвестный статус "${status}"`);
    return mapped;
}

function formatAddress(address) {
    if (!address) return null;
    if (typeof address === 'string') return address;
    return [address.city, address.street, address.house, address.flat]
        .filter(Boolean)
        .join(', ') || null;
}

function extractShipment(shipment) {
    if (!shipment || !shipment.id) return null;

    return {
        external_id: String(shipment.id),
        external_system: 'fulfillment',
        version: shipment.updated_at || shipment.status || 'na',
        order: {
            customer_name: shipment.customer?.name || 'Unknown',
            customer_phone: shipment.customer?.phone || `unknown_${shipment.id}`,
            delivery_address: formatAddress(shipment.delivery_address),
            currency: process.env.FF_CURRENCY || 'RUB',
            total_amount_minor: Math.round((shipment.total || 0) * 100),
            status: mapStatus(shipment.status),
            comment: `Fulfillment shipment ${shipment.number || shipment.id}`,
            items: (shipment.items || []).map(item => ({
                external_id: item.sku || null,
                name: item.name || null,
                quantity: item.quantity || 1,
                price_minor: Math.round((item.price || 0) * 100)
            }))
        }
    };
}

module.exports = { extractShipment, mapStatus, STATUS_MAP };
