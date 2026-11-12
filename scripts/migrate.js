#!/usr/bin/env node
// Применяет SQL-миграции из migrations/ по порядку. Уже применённые пропускает.
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate(pool, dir = path.join(__dirname, '..', 'migrations')) {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const applied = [];
    for (const file of files) {
        if (done.has(file)) continue;
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
            await client.query('COMMIT');
            applied.push(file);
        } catch (e) {
            await client.query('ROLLBACK');
            throw new Error(`Миграция ${file} не применена: ${e.message}`);
        } finally {
            client.release();
        }
    }
    return applied;
}

module.exports = { migrate };

if (require.main === module) {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    });
    migrate(pool)
        .then(a => { console.log(a.length ? `Применено: ${a.join(', ')}` : 'Новых миграций нет'); return pool.end(); })
        .catch(e => { console.error(e.message); process.exit(1); });
}
