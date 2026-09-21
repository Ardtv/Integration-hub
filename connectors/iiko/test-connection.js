require('dotenv').config({ path: __dirname + '/../../.env' });
const IikoClient = require('./iiko-client');

async function main() {
    console.log('════════ IIKO API TEST ════════');
    console.log('');

    console.log('▶ Тест 0: Проверка переменных');
    const required = ['IIKO_API_KEY', 'IIKO_APP_ID', 'IIKO_CLIENT_SECRET'];
    let missing = 0;
    for (const v of required) {
        const ok = !!process.env[v];
        console.log(`   ${v}: ${ok ? '✅' : '❌ не задан'}`);
        if (!ok) missing++;
    }
    if (missing > 0) {
        console.log('');
        console.log('❌ Не все переменные заданы. Запросите у заказчика:');
        console.log('   - IIKO_API_KEY (iikoWeb → Integrations → API Keys)');
        console.log('   - IIKO_APP_ID (https://public-api.iikoweb.ru/portal)');
        console.log('   - IIKO_CLIENT_SECRET (оттуда же)');
        process.exit(1);
    }
    console.log('');

    console.log('▶ Тест 1: Получение токена');
    try {
        const token = await IikoClient.getToken();
        console.log('✅ Токен получен:', token.substring(0, 20) + '...');
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
        process.exit(1);
    }
    console.log('');

    console.log('▶ Тест 2: Список организаций');
    try {
        const orgs = await IikoClient.getOrganizations();
        console.log('✅ Организаций:', orgs.organizations?.length || 0);
        for (const org of (orgs.organizations || [])) {
            console.log(`   - ${org.name} (id: ${org.id})`);
        }
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
    console.log('');

    console.log('════════ DONE ════════');
}

main();
