require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const CdekClient = require('./cdek-client');

async function main() {
    console.log('════════ CDEK API TEST ════════');
    console.log('');

    console.log('▶ Тест 0: Проверка переменных');
    const required = ['CDEK_CLIENT_ID', 'CDEK_CLIENT_SECRET'];
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

    console.log('▶ Тест 1: Получение токена');
    try {
        const token = await CdekClient.getToken();
        console.log('✅ Токен получен:', token.substring(0, 20) + '...');
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
        process.exit(1);
    }
    console.log('');

    console.log('▶ Тест 2: Health-check');
    try {
        const ping = await CdekClient.ping();
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
