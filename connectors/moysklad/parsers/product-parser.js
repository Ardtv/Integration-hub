function extractProduct(p) {
    if (!p || !p.id) return null;

    const salePrice = Array.isArray(p.salePrices) && p.salePrices.length > 0
        ? p.salePrices[0].value
        : null;

    const barcodes = Array.isArray(p.barcodes)
        ? p.barcodes.map(b => Object.values(b)[0]).filter(Boolean)
        : [];

    return {
        external_id: p.id,
        external_system: 'moysklad',
        product: {
            name: p.name || null,
            sku: p.article || p.code || null,
            code: p.code || null,
            price_minor: typeof salePrice === 'number' ? Math.round(salePrice) : null,
            currency: 'RUB',
            archived: Boolean(p.archived),
            barcodes,
            updated: p.updated || null
        }
    };
}

function idFromHref(href) {
    if (!href) return null;
    return String(href).split('?')[0].split('/').pop() || null;
}

module.exports = { extractProduct, idFromHref };
