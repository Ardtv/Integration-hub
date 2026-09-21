const STATUS_MAP = {
    '142': 'new',      // Новая сделка
    '143': 'processing',   // В работе
    '144': 'delivered',    // Доставлен
    '145': 'canceled'      // Отменен
};

function parseDealToOrder(dealData, contactData, productsData) {
    const phoneField = contactData?.custom_fields_values?.find(
        f => f.field_code === 'PHONE'
    );
    const phone = phoneField?.values?.[0]?.value || '';

    const addressField = dealData.custom_fields_values?.find(
        f => f.field_code === 'ADDRESS'
    );
    const address = addressField?.values?.[0]?.value || '';

    let totalAmount = 0;
    const items = (productsData || []).map(p => {
        const price = p.price || 0;
        const quantity = p.quantity || 1;
        const total = price * quantity;
        totalAmount += total;
        
        return {
            product_id: p.catalog_element_id || 0,
            quantity: quantity,
            price: price,
            total: total
        };
    });

    return {
        eventType: 'deal.created',
        source: 'amo',
        payload: {
            order: {
                customer_name: contactData?.name || dealData.name || 'Unknown',
                customer_phone: phone,
                delivery_address: address,
                currency: 'RUB',
                total_amount_minor: Math.round(totalAmount * 100), // В копейках
                status: STATUS_MAP[dealData.status_id] || 'new',
                comment: dealData.description || '',
                items: items
            },
            external_id: String(dealData.id),
            external_system: 'amo'
        },
        operationKey: `amo_${dealData.id}_${Date.now()}`
    };
}

module.exports = { parseDealToOrder, STATUS_MAP };
