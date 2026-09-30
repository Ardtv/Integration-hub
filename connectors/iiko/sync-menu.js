/**
 * Синхронизация меню из IIKO в БД (products)
 *
 * Запуск:
 *   node connectors/iiko/sync-menu.js
 *
 * Cron: каждые 15 минут
 *   (см. scripts/setup-iiko-cron.sh)
 */

require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const IikoClient = require('./iiko-client');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

async function syncMenu() {
    const startTime = Date.now();
    console.log('🔄 IIKO menu sync started');

    const orgId = process.env.IIKO_ORGANIZATION_ID;
    if (!orgId) {
        console.error('❌ IIKO_ORGANIZATION_ID не задан в .env');
        process.exit(1);
    }

    try {
// Получаем список внешних меню
const menuList = await IikoClient.getExternalMenus(orgId);
const externalMenus = menuList.externalMenus || [];

if (externalMenus.length === 0) {
    console.log('ℹ️ Внешних меню нет');
    return { synced: 0, created: 0, updated: 0 };
}

const externalMenu = externalMenus[0];
console.log(`📋 Внешнее меню: "${externalMenu.name}" (id: ${externalMenu.id})`);

// Получаем состав меню
const menu = await IikoClient.getExternalMenuById(orgId, externalMenu.id);

// Собираем товары из категорий
const products = [];
const groups = menu.itemCategories || [];

for (const category of groups) {
    for (const item of (category.items || [])) {
        products.push({
            id: item.itemId,
            name: item.name,
            sku: item.sku,
            categoryName: category.name,
            price: item.itemSizes?.[0]?.prices?.[0]?.price || 0
        });
    }
}

console.log(`📦 Найдено: товаров ${products.length}, групп ${groups.length}`);
        if (products.length === 0) {
            console.log('ℹ️ Меню пустое — нечего синхронизировать');
            return { synced: 0, created: 0, updated: 0 };
        }

        let created = 0;
        let updated = 0;

        for (const product of products) {
            try {
const mapping = await pool.query(
    `SELECT internal_id FROM external_id_mapping
     WHERE external_system = 'iiko'
       AND external_id = $1
       AND internal_table = 'external_products'`,
    [product.id]
);
const price = product.price || 0;
const name = product.name || 'Unknown';
if (mapping.rows.length > 0) {
    await pool.query(
        `UPDATE external_products
         SET name = $1, sku = $2, category_name = $3, price_rub = $4, updated_at = NOW()
         WHERE external_system = 'iiko' AND external_id = $5`,
[name, product.sku, product.categoryName, Math.round(price / 100), product.id]
    );
    updated++;
} else {
    const result = await pool.query(
        `INSERT INTO external_products
         (external_id, external_system, name, sku, category_name, price_rub, created_at, updated_at)
         VALUES ($1, 'iiko', $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
[product.id, name, product.sku, product.categoryName, Math.round(price / 100)]
    );

    await pool.query(
        `INSERT INTO external_id_mapping
         (internal_table, internal_id, external_system, external_id, created_at, updated_at)
         VALUES ('external_products', $1, 'iiko', $2, NOW(), NOW())`,
        [result.rows[0].id, product.id]
    );
    created++;
}
            } catch (e) {
                console.error(`❌ Ошибка для product ${product.id}:`, e.message);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Синхронизация: создано ${created}, обновлено ${updated}, время ${duration}мс`);

        return { synced: products.length, created, updated };
    } catch (e) {
        console.error('❌ Sync failed:', e.message);
        throw e;
    } finally {
        await pool.end();
    }
}

syncMenu()
    .then(result => {
        console.log('✅ Done:', JSON.stringify(result));
        process.exit(0);
    })
    .catch(e => {
        console.error('❌ Fatal:', e.message);
        process.exit(1);
    });
