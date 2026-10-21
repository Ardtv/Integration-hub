const STATUS_MAP = {
    CREATED: 'new',
    ACCEPTED: 'processing',
    RECEIVED_AT_SHIPMENT_WAREHOUSE: 'processing',
    READY_TO_SHIP_AT_SENDING_OFFICE: 'processing',
    READY_FOR_SHIPMENT_IN_SENDER_CITY: 'processing',
    TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 'delivering',
    SENT_TO_TRANSIT_CITY: 'delivering',
    ACCEPTED_IN_TRANSIT_CITY: 'delivering',
    SENT_TO_RECIPIENT_CITY: 'delivering',
    ACCEPTED_IN_RECIPIENT_CITY: 'delivering',
    TAKEN_BY_COURIER: 'delivering',
    ACCEPTED_AT_PICK_UP_POINT: 'ready',
    DELIVERED: 'delivered',
    NOT_DELIVERED: 'failed',
    INVALID: 'cancelled',
    CANCELLED: 'cancelled',
    REFUSED: 'cancelled'
};

function mapStatus(code) {
    if (!code) return undefined;
    const mapped = STATUS_MAP[String(code).toUpperCase()];
    if (!mapped) console.warn(`⚠️ CDEK: неизвестный статус "${code}"`);
    return mapped;
}

function formatAddress(location) {
    if (!location) return null;
    if (location.address && !location.city) return location.address;
    return [location.city, location.address || location.street, location.house, location.flat]
        .filter(Boolean)
        .join(', ') || null;
}

function collectItems(cdekOrder) {
    const fromPackages = (cdekOrder.packages || []).flatMap(p => p.items || []);
    const items = fromPackages.length > 0 ? fromPackages : (cdekOrder.items || []);
    return items.map(item => ({
        external_id: item.ware_key || item.uuid || null,
        name: item.name || null,
        quantity: item.amount || 1,
        price_minor: Math.round((item.cost || item.price || 0) * 100)
    }));
}

function extractOrder(cdekOrder) {
    if (!cdekOrder || !cdekOrder.uuid) return null;

    const lastStatus = (cdekOrder.statuses || [])[0] || {};
    const phone = cdekOrder.recipient?.phones?.[0]?.number;

    return {
        external_id: cdekOrder.uuid,
        external_system: 'cdek',
        version: lastStatus.date_time || lastStatus.code || 'na',
        order: {
            customer_name: cdekOrder.recipient?.name || 'Unknown',
            customer_phone: phone || `unknown_${cdekOrder.uuid}`,
            delivery_address: formatAddress(cdekOrder.to_location),
            currency: process.env.FF_CURRENCY || 'RUB',
            status: mapStatus(lastStatus.code),
            comment: `CDEK ${cdekOrder.cdek_number || cdekOrder.uuid}`,
            items: collectItems(cdekOrder)
        }
    };
}

function extractStatusEvent(body) {
    if (!body || body.type !== 'ORDER_STATUS' || !body.uuid) return null;
    const a = body.attributes || {};

    return {
        external_id: body.uuid,
        external_system: 'cdek',
        version: a.status_date_time || body.date_time || a.code || 'na',
        order: {
            status: mapStatus(a.code),
            comment: a.cdek_number ? `CDEK ${a.cdek_number}` : undefined
        }
    };
}

module.exports = { extractOrder, extractStatusEvent, mapStatus, STATUS_MAP };
