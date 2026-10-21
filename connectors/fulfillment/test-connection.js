require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const FulfillmentClient = require('./fulfillment-client');

async function main() {
    console.log('════════ FULFILLMENT API TEST ════════');
    console.log('');

    console.log('▶ Тест 0: Проверка переменных');
    const required = ['FULFILLMENT_API_KEY', 'FULFILLMENT_API_BASE'];
    let missing = 0;
    for (const v of required) {
        const ok = !!process.env[v];
        console.log(`   ${v}: ${ok ? '✅' : '❌ не задан'}`);
        if (!ok) missing++;
    }
    if (missing > 0) {
        console.log('❌ Не все переменные заданы');
        process.exit(1);
    }
    console.log('');

    console.log('▶ Тест 1: Health-check');
    try {
        const ping = await FulfillmentClient.ping();
        console.log('✅ Ping:', ping);
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
    console.log('');

    console.log('════════ DONE ════════');
}

main().catch(e => {
    console.error('❌ Fatal:', e);
    process.exit(1);
});
