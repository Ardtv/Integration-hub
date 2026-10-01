require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const IikoClient = require('./iiko-client');

function isValidUuid(str) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRe.test(str);
}

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
    if (process.env.IIKO_APP_ID && !isValidUuid(process.env.IIKO_APP_ID)) {
        console.log('⚠️ IIKO_APP_ID не UUID');
    }
    if (missing > 0) {
        console.log('❌ Не все переменные заданы');
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
    let orgId;
    try {
        const orgs = await IikoClient.getOrganizations();
        const list = orgs.organizations || [];
        console.log('✅ Организаций:', list.length);
        for (const org of list) {
            console.log(`   - ${org.name} (id: ${org.id})`);
        }
        orgId = list[0]?.id;
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
    console.log('');

    if (!orgId) {
        console.log('⚠️ Нет организаций');
        return;
    }

    console.log('▶ Тест 3: Терминальные группы');
    try {
        const tg = await IikoClient.getTerminalGroups(orgId);
        const groups = tg.terminalGroups || [];
        let totalTerminals = 0;
        for (const g of groups) totalTerminals += (g.items?.length || 0);

        console.log(`✅ Терминальных групп: ${groups.length} | Терминалов: ${totalTerminals}`);

        for (const g of groups) {
            console.log(`   Группа orgId: ${g.organizationId}`);
            for (const item of (g.items || [])) {
                console.log(`     • ${item.name}`);
                console.log(`       id: ${item.id}`);
                console.log(`       posVersion: ${item.posVersion || '—'}`);
                console.log(`       timezone: ${item.timeZone || '—'}`);
            }
        }
        console.log(`   ℹ️ terminalGroupsInSleep: ${(tg.terminalGroupsInSleep || []).length}`);
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
    console.log('');

    console.log('▶ Тест 4: Внешнее меню');
try {
    const menuList = await IikoClient.getExternalMenus(orgId);
    const externalMenus = menuList.externalMenus || [];

    if (externalMenus.length === 0) {
        console.log('⚠️ Внешних меню нет');
    } else {
        const externalMenu = externalMenus[0];
        console.log(`✅ Внешних меню: ${externalMenus.length}`);
        console.log(`   - ${externalMenu.name} (id: ${externalMenu.id})`);

        const menu = await IikoClient.getExternalMenuById(orgId, externalMenu.id);
        const categories = menu.itemCategories || [];
        let totalItems = 0;
        for (const cat of categories) {
            totalItems += (cat.items || []).length;
        }
        console.log(`   Категорий: ${categories.length} | Товаров: ${totalItems}`);
    }
} catch (e) {
    console.error('❌ Ошибка:', e.message);
}
    console.log('');

    console.log('▶ Тест 5: Стоп-лист');
    try {
        const stop = await IikoClient.getStopList(orgId);
        const sl = stop.stopLists || [];
        console.log(`✅ Стоп-листов: ${sl.length}`);
        for (const s of sl) {
            console.log(`   - terminalGroupId: ${s.terminalGroupId || '—'}, позиций: ${s.items?.length || 0}`);
        }
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
    console.log('');

    console.log('▶ Тест 6: Остатки склада');
    try {
        const stock = await IikoClient.getStockBalance(orgId);
        const items = stock.items || [];
        console.log(`✅ Позиций на складе: ${items.length}`);
        console.log(`   balanceAt: ${stock.balanceAt}`);
        console.log(`   generatedAt: ${stock.generatedAt}`);

        // Считаем позиции с остатком > 0
        const withStock = items.filter(i => i.quantity > 0);
        const negative = items.filter(i => i.quantity < 0);
        const zero = items.filter(i => i.quantity === 0);

        console.log(`   С остатком > 0: ${withStock.length}`);
        console.log(`   С остатком < 0: ${negative.length}`);
        console.log(`   С остатком = 0: ${zero.length}`);

        for (const item of items.slice(0, 5)) {
            console.log(`   - productId: ${item.productId} | qty: ${item.quantity}`);
        }
    } catch (e) {
        if (e.response?.status === 401) {
            console.log('⚠️ Склад недоступен на текущем apiKey (401)');
        } else {
            console.error('❌ Ошибка:', e.message);
            if (e.response) {
                console.error('   Body:', JSON.stringify(e.response.data));
            }
        }
    }
    console.log('');

    console.log('════════ DONE ════════');
}

main().catch(e => {
    console.error('❌ Fatal:', e);
    process.exit(1);
});
