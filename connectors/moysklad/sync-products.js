require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });

const fs = require('fs');
const HubClient = require('../shared/hub-client');
const MoyskladClient = require('./moysklad-client');
const { extractProduct } = require('./parsers/product-parser');

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const dryRun = args.includes('--dry-run');

function log(msg) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`[${ts}] ${msg}`);
}

async function loadProducts() {
    if (fileArg) {
        const data = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
        return Array.isArray(data) ? data : (data.rows || []);
    }
    return MoyskladClient.getAllProducts();
}

async function sendProduct(p) {
    const event = extractProduct(p);
    if (!event) return 'skipped';
    if (dryRun) return 'dry';
    const version = event.product.updated || 'na';
    const result = await HubClient.sendWithRetry({
        eventType: 'moysklad.product.updated',
        source: 'moysklad',
        payload: event,
        operationKey: `moysklad_${event.external_id}_sync_${version}`
    });
    return result && result.status === 'duplicate' ? 'duplicate' : 'accepted';
}

async function main() {
    const token = process.env.MOYSKLAD_TOKEN || '';
    if (!fileArg && (!token || token.startsWith('your-'))) {
        log('⏭ MOYSKLAD_TOKEN не задан или заглушка — синхронизация пропущена');
        return;
    }
    const started = Date.now();
    log(`🔄 MoySklad sync started${fileArg ? ' (file: ' + fileArg + ')' : ''}${dryRun ? ' [dry-run]' : ''}`);
    const products = await loadProducts();
    log(`📦 Товаров получено: ${products.length}`);

    const stats = { accepted: 0, duplicate: 0, skipped: 0, dry: 0, failed: 0 };
    for (const p of products) {
        try {
            stats[await sendProduct(p)]++;
        } catch (e) {
            stats.failed++;
            log(`❌ ${p.id || '?'}: ${e.message}`);
        }
    }
    log(`✅ Готово за ${Date.now() - started} мс: ${JSON.stringify(stats)}`);
    if (stats.failed > 0) process.exitCode = 1;
}

main().catch(e => {
    log(`❌ Fatal: ${e.response?.status ? 'HTTP ' + e.response.status : e.message}`);
    process.exit(1);
});
