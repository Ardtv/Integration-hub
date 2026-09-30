/**
 * Отправка заказа из Hub в IIKO
 *
 * Использование:
 *   const { sendOrderToIiko } = require('./send-order');
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

async function mapItemsToIiko(items) {
    if (!items || items.length === 0) return [];

    const result = [];

    for (const item of items) {
        const mapping = await pool.query(
            `SELECT external_id FROM external_id_mapping
             WHERE internal_table = 'products'
               AND external_system = 'iiko'
               AND internal_id = $1`,
            [item.product_id]
        );

        if (mapping.rows.length === 0) {
            throw new Error(`Product ${item.product_id} не найден в mapping с IIKO`);
        }

        result.push({
            productId: mapping.rows[0].external_id,
            amount: item.quantity || 1
        });
    }

    return result;
}

async function sendOrderToIiko(order) {
    const orgId = process.env.IIKO_ORGANIZATION_ID;
    const terminalGroupId = process.env.IIKO_TERMINAL_GROUP_ID;

    if (!orgId || !terminalGroupId) {
        throw new Error('IIKO_ORGANIZATION_ID или IIKO_TERMINAL_GROUP_ID не заданы');
    }

    console.log(`📤 Отправка заказа ${order.id} в IIKO`);

    const iikoItems = await mapItemsToIiko(order.items);

    const iikoOrder = {
        phone: order.customer_phone,
        items: iikoItems,
        comment: order.comment || `Order #${order.id} from Hub`
    };

    if (order.delivery_address) {
        iikoOrder.address = {
            street: order.delivery_address
        };
    }

    const result = await IikoClient.createDeliveryOrder(
        orgId,
        terminalGroupId,
        iikoOrder
    );

    console.log('✅ Заказ отправлен в IIKO:', JSON.stringify(result));

    if (result.orderInfo?.id) {
        await pool.query(
            `UPDATE orders SET iiko_order_id = $1, updated_at = NOW() WHERE id = $2`,
            [result.orderInfo.id, order.id]
        );
    }

    return result;
}

module.exports = { sendOrderToIiko };

if (require.main === module) {
    console.log('ℹ️ Модуль. Используется программно.');
    process.exit(0);
}
