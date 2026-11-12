#!/usr/bin/env node
// Показывает воронки, этапы, поля сделок и каталоги amoCRM с их ID.
// Ничего не меняет. Нужен, чтобы заполнить AMO_* в .env.
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const AmoClient = require('../connectors/amo/amo-client');

(async () => {
    const amo = new AmoClient(process.env.AMO_API_TOKEN, process.env.AMO_API_DOMAIN);
    console.log('ВОРОНКИ И ЭТАПЫ');
    for (const p of await amo.listPipelines()) {
        console.log(`\n  Воронка «${p.name}»  id=${p.id}`);
        for (const s of p._embedded?.statuses || []) console.log(`    ${String(s.id).padEnd(12)} ${s.name}`);
    }
    console.log('\nПОЛЯ СДЕЛКИ');
    for (const f of await amo.listLeadFields()) {
        const enums = (f.enums || []).map(e => e.value).join(' | ');
        console.log(`  ${String(f.id).padEnd(12)} ${f.type.padEnd(12)} ${f.name}${enums ? '  [' + enums + ']' : ''}`);
    }
    console.log('\nКАТАЛОГИ');
    for (const c of await amo.listCatalogs()) console.log(`  ${String(c.id).padEnd(12)} ${c.type.padEnd(10)} ${c.name}`);
})().catch(e => { console.error(e.message); process.exit(1); });
