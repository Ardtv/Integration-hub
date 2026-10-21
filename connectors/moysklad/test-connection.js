require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const MoyskladClient = require('./moysklad-client');
const { extractProduct } = require('./parsers/product-parser');

async function main() {
    console.log('════════ MOYSKLAD API TEST ════════');
    console.log('');

    console.log('▶ Тест 0: Проверка переменных');
    const ok = !!process.env.MOYSKLAD_TOKEN;
    console.log(`   MOYSKLAD_TOKEN: ${ok ? '✅' : '❌ не задан'}`);
    if (!ok) process.exit(1);
    console.log('');

    console.log('▶ Тест 1: Доступ к API');
    const ping = await MoyskladClient.ping();
    console.log(ping.ok ? '✅ МойСклад отвечает' : `❌ ${ping.error}`);
    console.log('');
    if (!ping.ok) {
        console.log('════════ DONE ════════');
        return;
    }

    console.log('▶ Тест 2: Товары');
    const page = await MoyskladClient.getProducts({ limit: 5 });
    console.log(`✅ Всего товаров: ${page.meta?.size ?? '?'}`);
    for (const p of page.rows || []) {
        const parsed = extractProduct(p);
        console.log(`   ${parsed.product.sku || '-'} | ${parsed.product.name} | ${parsed.product.price_minor ?? '-'} коп.`);
    }
    console.log('');

    console.log('▶ Тест 3: Остатки');
    const stock = await MoyskladClient.getStock({ limit: 5 });
    console.log(`✅ Позиций в отчёте: ${stock.meta?.size ?? (stock.rows || []).length}`);
    for (const s of stock.rows || []) console.log(`   ${s.name} | остаток ${s.stock ?? '-'}`);
    console.log('');

    console.log('▶ Тест 4: Вебхуки');
    const hooks = await MoyskladClient.listWebhooks();
    console.log(`✅ Зарегистрировано: ${(hooks.rows || []).length}`);
    for (const h of hooks.rows || []) console.log(`   ${h.entityType} ${h.action} → ${h.url}`);
    console.log('');

    console.log('════════ DONE ════════');
}

main().catch(e => {
    console.error('❌ Fatal:', e.response?.status || e.message);
    process.exit(1);
});
