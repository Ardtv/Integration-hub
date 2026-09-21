require('dotenv').config({ path: __dirname + '/../../.env' });
const IikoClient = require('./iiko-client');

async function main() {
    console.log('════════ IIKO API TEST ════════');
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
