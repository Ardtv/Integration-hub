#!/usr/bin/env node
// Предлагает сопоставление товаров amo с IIKO и фулфилментом по совпадению названий.
// Заполняет только пустые поля product_map и только при точном совпадении названия.
//   node scripts/product-map-suggest.js           показать предложения
//   node scripts/product-map-suggest.js --apply   записать
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const { Pool } = require('pg');

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

(async () => {
    const apply = process.argv.includes('--apply');
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
    });
    const map = (await pool.query('SELECT * FROM product_map ORDER BY amo_name')).rows;
    const iiko = (await pool.query(`SELECT external_id, name FROM external_products WHERE external_system = 'iiko'`)).rows;
    const ff = (await pool.query('SELECT sku, name FROM ff_offers WHERE sku IS NOT NULL')).rows;

    const byName = rows => {
        const idx = new Map();
        for (const r of rows) { const k = norm(r.name); if (!k) continue; idx.set(k, idx.has(k) ? null : r); } // null = неоднозначно
        return idx;
    };
    const iikoIdx = byName(iiko), ffIdx = byName(ff);

    let suggested = 0, unresolved = 0;
    for (const row of map) {
        const key = norm(row.amo_name);
        const i = !row.iiko_product_id ? iikoIdx.get(key) : null;
        const f = !row.cdek_sku ? ffIdx.get(key) : null;
        if (!row.iiko_product_id && !i) unresolved++;
        if (!i && !f) continue;
        suggested++;
        console.log(`${row.amo_name}  →  IIKO: ${i ? i.external_id : '—'}  фулфилмент: ${f ? f.sku : '—'}`);
        if (apply) {
            await pool.query(
                `UPDATE product_map SET iiko_product_id = COALESCE(iiko_product_id, $2), cdek_sku = COALESCE(cdek_sku, $3), updated_at = now() WHERE amo_product_id = $1`,
                [row.amo_product_id, i ? i.external_id : null, f ? f.sku : null]
            );
        }
    }
    await pool.end();
    console.log(`\nПредложений: ${suggested}${apply ? ' (записаны)' : ' (для записи добавьте --apply)'}. Без пары в IIKO осталось: ${unresolved}.`);
    console.log('Карточки 1С (onec_ref) и единицы IIKO заполняются вручную в панели контроля.');
})().catch(e => { console.error(e.message); process.exit(1); });
