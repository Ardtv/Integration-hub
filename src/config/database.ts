import { Pool } from 'pg';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

export const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'instinct_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
});

// Обрыв простаивающего соединения (например, перезапуск PostgreSQL) не должен ронять процесс.
pool.on('error', err => logger.error({ err: err.message }, 'Ошибка соединения с базой'));

export async function testConnection(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        logger.info('Database connected');
        return true;
    } catch (error) {
        logger.error({ err: error }, 'Database connection failed');
        return false;
    }
}
