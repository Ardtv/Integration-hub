// Синхронизация справочника товаров IIKO (внешнее меню) в таблицу external_products.
// Запуск: node connectors/iiko/sync-menu.js   (cron ставит scripts/install-cron.sh)
require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const { Pool } = require('pg');
const IikoClient = require('./iiko-client');

async function main() {
    const orgId = process.env.IIKO_ORGANIZATION_ID;
    if (!orgId) throw new Error('IIKO_ORGANIZATION_ID не задан');

    const menus = (await IikoClient.getExternalMenus(orgId)).externalMenus || [];
    if (menus.length === 0) { console.log('Внешних меню нет'); return; }
    const wanted = process.env.IIKO_EXTERNAL_MENU_ID;
    const menuRef = (wanted && menus.find(m => String(m.id) === wanted)) || menus[0];
    const menu = await IikoClient.getExternalMenuById(orgId, menuRef.id);

    const products = [];
    for (const category of menu.itemCategories || []) {
        for (const item of category.items || []) {
            products.push({
                id: item.itemId, name: item.name || null, sku: item.sku || null, category: category.name || null,
                // Цена сохраняется как пришла из IIKO: в какой она валюте, нужно подтвердить у заказчика.
                price: item.itemSizes?.[0]?.prices?.[0]?.price ?? null
            });
        }
    }

    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
    });
    try {
        for (const p of products) {
            if (!p.id) continue;
            await pool.query(
                `INSERT INTO external_products (external_system, external_id, name, sku, category_name, price_raw)
                 VALUES ('iiko', $1, $2, $3, $4, $5)
                 ON CONFLICT (external_system, external_id) DO UPDATE SET
                    name = EXCLUDED.name, sku = EXCLUDED.sku, category_name = EXCLUDED.category_name,
                    price_raw = EXCLUDED.price_raw, updated_at = now()`,
                [p.id, p.name, p.sku, p.category, p.price]
            );
        }
    } finally {
        await pool.end();
    }
    console.log(`[${new Date().toISOString()}] IIKO: меню «${menuRef.name}», товаров ${products.length}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
