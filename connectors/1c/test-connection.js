require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const OneCClient = require('./1c-client');

async function main() {
    console.log('════════ 1C API TEST ════════');
    console.log('');

    console.log('▶ Тест 0: Проверка переменных');
    const required = ['API_1C_BASE', 'API_1C_USER', 'API_1C_PASSWORD'];
    let missing = 0;
    for (const v of required) {
        const ok = !!process.env[v];
        console.log(`   ${v}: ${ok ? '✅' : '❌ не задан'}`);
        if (!ok) missing++;
    }
    console.log(`   API_1C_ORDER_DOCUMENT: ${process.env.API_1C_ORDER_DOCUMENT || 'Document_ЗаказКлиента (по умолчанию)'}`);
    if (missing > 0) {
        console.log('❌ Не все переменные заданы');
        process.exit(1);
    }
    console.log('');

    console.log('▶ Тест 1: Доступность OData');
    const ping = await OneCClient.ping();
    console.log(ping.ok ? '✅ 1С отвечает' : `❌ ${ping.error}`);
    console.log('');

    if (ping.ok) {
        console.log('▶ Тест 2: Последние заказы');
        try {
            const orders = await OneCClient.getOrders({ top: 3 });
            console.log(`✅ Получено: ${orders.length}`);
            for (const o of orders) console.log(`   ${o.Number || '?'} | ${o.Date || '?'} | ${o.Ref_Key || '?'}`);
        } catch (e) {
            console.error('❌ Ошибка:', e.response?.status || e.message);
        }
        console.log('');
    }

    console.log('════════ DONE ════════');
}

main().catch(e => {
    console.error('❌ Fatal:', e);
    process.exit(1);
});
