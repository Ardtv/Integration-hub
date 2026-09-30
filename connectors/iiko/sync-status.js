/**
 * Синхронизация статусов заказов из IIKO
 *
 * Запуск:
 *   node connectors/iiko/sync-status.js
 *
 * Cron: каждые 5 минут (см. scripts/setup-iiko-cron.sh)
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

function mapIikoStatus(iikoStatus) {
    const MAP = {
        'New': 'pending',
        'WaitCooking': 'processing',
        'Cooking': 'processing',
        'ReadyForCooking': 'processing',
        'CookingCompleted': 'ready',
        'Waiting': 'ready',
        'OnWay': 'delivering',
        'Delivered': 'delivered',
        'Closed': 'completed',
        'Cancelled': 'cancelled'
    };
    return MAP[iikoStatus] || 'unknown';
}

async function syncStatuses() {
    const startTime = Date.now();
    console.log('🔄 IIKO status sync started');

    const orgId = process.env.IIKO_ORGANIZATION_ID;
    if (!orgId) {
        console.error('❌ IIKO_ORGANIZATION_ID не задан');
        process.exit(1);
    }

    try {
        const result = await pool.query(
            `SELECT id, iiko_order_id, status
             FROM orders
             WHERE iiko_order_id IS NOT NULL
               AND status NOT IN ('completed', 'cancelled', 'delivered')
             LIMIT 50`
        );

        const orders = result.rows;
        console.log(`📦 Заказов для проверки: ${orders.length}`);

        let updated = 0;

        for (const order of orders) {
            try {
                const iikoResult = await IikoClient.getOrderById(orgId, order.iiko_order_id);
                const iikoOrders = iikoResult.orders || [];

                if (iikoOrders.length === 0) {
                    console.warn(`⚠️ Заказ ${order.iiko_order_id} не найден в IIKO`);
                    continue;
                }

                const iikoStatus = iikoOrders[0].status;
                const ourStatus = mapIikoStatus(iikoStatus);

                if (ourStatus !== 'unknown' && ourStatus !== order.status) {
                    await pool.query(
                        `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                        [ourStatus, order.id]
                    );
                    console.log(`✅ Заказ ${order.id}: ${order.status} → ${ourStatus}`);
                    updated++;
                }
            } catch (e) {
                console.error(`❌ Ошибка для order ${order.id}:`, e.message);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Синхронизация: обновлено ${updated}, время ${duration}мс`);

        return { checked: orders.length, updated };
    } catch (e) {
        console.error('❌ Sync failed:', e.message);
        throw e;
    } finally {
        await pool.end();
    }
}

syncStatuses()
    .then(result => {
        console.log('✅ Done:', JSON.stringify(result));
        process.exit(0);
    })
    .catch(e => {
        console.error('❌ Fatal:', e.message);
        process.exit(1);
    });

