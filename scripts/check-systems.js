#!/usr/bin/env node
// Проверка доступов IIKO, фулфилмента СДЭК (Orderadmin) и 1С. Только чтение, ничего не создаёт.
//   node scripts/check-systems.js            все системы
//   node scripts/check-systems.js iiko ff 1c выбранные
// Если в терминале остались старые переменные: env -i PATH="$PATH" HOME="$HOME" node scripts/check-systems.js
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });

const want = process.argv.slice(2);
const on = name => want.length === 0 || want.includes(name);
const err = e => (e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data).slice(0, 300)}` : e.message);

async function iiko() {
    console.log('\n=== IIKO');
    const Iiko = require('../connectors/iiko/iiko-client');
    await Iiko.getToken();
    console.log('Авторизация: OK');
    const orgs = await Iiko.getOrganizations();
    const list = orgs?.organizations || orgs || [];
    console.log(`Организаций: ${list.length}`);
    for (const o of list) console.log(`  IIKO_ORGANIZATION_ID=${o.id}   ${o.name}`);
    for (const o of list) {
        try {
            const m = await Iiko.getExternalMenus(o.id);
            for (const x of m?.externalMenus || []) console.log(`  меню: IIKO_EXTERNAL_MENU_ID=${x.id}   ${x.name}`);
        } catch (e) { console.log(`  внешние меню: ${err(e)}`); }
    }
}

async function ff() {
    console.log('\n=== Фулфилмент СДЭК (Orderadmin)');
    const Ff = require('../connectors/fulfillment/orderadmin-client');
    await Ff.getToken();
    console.log('Авторизация: OK');
    for (const [title, path, key] of [
        ['Склады', '/api/storage/warehouse', 'warehouse'],
        ['Магазины', '/api/products/shops', 'shops'],
        ['Отправители', '/api/delivery-services/senders', 'senders']
    ]) {
        try {
            const d = await Ff.get(path, { per_page: 50 });
            const rows = d._embedded?.[key] || [];
            console.log(`${title}: ${rows.length}`);
            for (const r of rows) console.log(`  ${r.id}   ${r.name || r.title || ''}${r.type ? '   ' + r.type : ''}`);
        } catch (e) { console.log(`${title}: ${err(e)}`); }
    }
    const offers = await Ff.getAllOffers();
    console.log(`Товары на складе: ${offers.length}`);
    for (const o of offers) {
        const sku = o.sku || (o.barcodes || [])[0] || '';
        console.log(`  id=${o.id}   артикул=${o.article || ''}   sku=${sku}   ${o.name}   вес=${o.weight || ''}   ${(o.dimensions && JSON.stringify(o.dimensions)) || ''}`);
    }
}

async function onec() {
    console.log('\n=== 1С');
    const OneC = require('../connectors/1c/1c-client');
    OneC.assertConfig();
    const r = await OneC.ping();
    console.log(r.ok ? 'OData: OK' : `OData: ${r.error}`);
}

(async () => {
    for (const [name, fn] of [['iiko', iiko], ['ff', ff], ['1c', onec]]) {
        if (!on(name)) continue;
        try { await fn(); } catch (e) { console.log(`Ошибка: ${err(e)}`); }
    }
})();
