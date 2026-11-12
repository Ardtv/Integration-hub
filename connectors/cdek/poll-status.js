// Запасной опрос СДЭК по cron: если вебхук не дошёл, статусы всё равно попадут в хаб.
// Дубли не страшны: у каждого статуса свой ключ операции.
require('dotenv').config({ path: __dirname + '/../../.env', quiet: true });
const { Pool } = require('pg');
const CdekClient = require('./cdek-client');
const HubClient = require('../shared/hub-client');
const { eventsFromOrder } = require('./webhook-server');

async function main() {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD
    });
    const { rows } = await pool.query(
        `SELECT cdek_uuid FROM shipments
          WHERE cdek_uuid IS NOT NULL AND cdek_uuid NOT LIKE 'dry-%' AND state IN ('cdek_created', 'shipped')
          ORDER BY updated_at LIMIT 100`
    );
    await pool.end();
    let sent = 0, failed = 0;
    for (const { cdek_uuid } of rows) {
        try {
            const data = await CdekClient.getOrder(cdek_uuid);
            for (const ev of eventsFromOrder(data?.entity)) {
                const r = await HubClient.sendWithRetry(ev);
                if (r?.status === 'accepted') sent++;
            }
        } catch (e) {
            failed++;
            console.error(`${cdek_uuid}: ${e.message}`);
        }
    }
    console.log(`[${new Date().toISOString()}] СДЭК: заказов ${rows.length}, новых статусов ${sent}, ошибок ${failed}`);
    if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e.message); process.exit(1); });
