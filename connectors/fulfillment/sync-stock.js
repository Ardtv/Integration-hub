require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const HubClient = require('../shared/hub-client');
const OrderadminClient = require('./orderadmin-client');

const dryRun = process.argv.includes('--dry-run');
const CURRENCY = process.env.FF_CURRENCY || 'RUB';

function log(msg) {
    console.log(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${msg}`);
}

function toEvent(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    const stock = items.filter(i => i.state === 'normal').reduce((s, i) => s + (Number(i.count) || 0), 0);
    return {
        external_id: String(o.id),
        external_system: 'cdek_ff',
        product: {
            name: o.name || null,
            sku: o.sku || null,
            article: o.article || null,
            price_minor: Math.round((Number(o.price) || 0) * 100),
            currency: CURRENCY,
            stock,
            warehouses: items.map(i => ({ warehouse: i.warehouse, state: i.state, count: Number(i.count) || 0 })),
            inventory_updated: o.inventoryUpdated || null
        }
    };
}

async function main() {
    const started = Date.now();
    log(`🔄 FF stock sync started${dryRun ? ' [dry-run]' : ''}`);
    const offers = (await OrderadminClient.getAllOffers()).filter(o => o.state !== 'inactive');
    log(`📦 Товаров: ${offers.length}`);

    const stats = { accepted: 0, duplicate: 0, failed: 0 };
    for (const o of offers) {
        const ev = toEvent(o);
        if (dryRun) {
            log(`   ${ev.product.sku || '-'} | ${ev.product.name} | остаток ${ev.product.stock} | ${ev.product.price_minor / 100} ${CURRENCY}`);
            continue;
        }
        try {
            const r = await HubClient.sendWithRetry({
                eventType: 'fulfillment.stock.updated',
                source: 'fulfillment',
                payload: ev,
                operationKey: `ff_stock_${o.id}_${ev.product.stock}_${ev.product.price_minor}_${o.updated || 'na'}`
            });
            stats[r && r.status === 'duplicate' ? 'duplicate' : 'accepted']++;
        } catch (e) {
            stats.failed++;
            log(`❌ ${o.id}: ${e.message}`);
        }
    }
    log(`✅ Готово за ${Date.now() - started} мс: ${JSON.stringify(stats)}`);
    if (stats.failed > 0) process.exitCode = 1;
}

main().catch(e => {
    log(`❌ Fatal: ${e.response?.status ? 'HTTP ' + e.response.status : e.message}`);
    process.exit(1);
});
