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
        const menu = await IikoClient.getNomenclature(orgId);
        const products = menu.products || [];
        const groups = menu.groups || [];

        console.log(`📦 Получено: товаров ${products.length}, групп ${groups.length}`);

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
                       AND internal_table = 'products'`,
                    [product.id]
                );

                const price = product.sizePrices?.[0]?.price?.current || 0;
                const name = product.name || 'Unknown';

                if (mapping.rows.length > 0) {
                    await pool.query(
                        `UPDATE products SET title = $1, price_minor = $2, updated_at = NOW()
                         WHERE id = $3`,
                        [name, Math.round(price * 100), mapping.rows[0].internal_id]
                    );
                    updated++;
                } else {
                    const result = await pool.query(
                        `INSERT INTO products (title, price_minor, created_at, updated_at)
                         VALUES ($1, $2, NOW(), NOW())
                         RETURNING id`,
                        [name, Math.round(price * 100)]
                    );

                    await pool.query(
                        `INSERT INTO external_id_mapping
                         (internal_table, internal_id, external_system, external_id, created_at, updated_at)
                         VALUES ('products', $1, 'iiko', $2, NOW(), NOW())`,
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
