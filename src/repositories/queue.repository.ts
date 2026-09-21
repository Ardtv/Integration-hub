import { Pool } from 'pg';

export interface QueueEvent {
    id: number;
    event_type: string;
    source: string;
    payload: any;
    status: 'pending' | 'processing' | 'processed' | 'failed' | 'dead';
    priority: number;
    created_at: Date;
    updated_at: Date;
    processed_at: Date | null;
    error_message: string | null;
    operation_key: string;
    retry_count: number;
    max_retries: number;
}

export class QueueRepository {
    constructor(private pool: Pool) {}

    async add(event: {
        eventType: string;
        source: string;
        payload: any;
        operationKey: string;
        priority?: number;
    }): Promise<QueueEvent | null> {
        const query = `
            INSERT INTO integration_queue 
            (event_type, source, payload, operation_key, priority)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (operation_key) DO NOTHING
            RETURNING *
        `;
        
        const result = await this.pool.query<QueueEvent>(query, [
            event.eventType,
            event.source,
            JSON.stringify(event.payload),
            event.operationKey,
            event.priority || 0
        ]);
        
        return result.rows[0] || null;
    }

    async getPending(limit: number = 10): Promise<QueueEvent[]> {
        const result = await this.pool.query<QueueEvent>(`
            SELECT * FROM integration_queue
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        `, [limit]);
        return result.rows;
    }

    async getForRetry(limit: number = 10): Promise<QueueEvent[]> {
        const result = await this.pool.query<QueueEvent>(`
            SELECT * FROM integration_queue
            WHERE status = 'failed'
              AND retry_count < max_retries
              AND (processed_at IS NULL 
                   OR processed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
            ORDER BY priority DESC, created_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        `, [limit]);
        return result.rows;
    }
 
    async markProcessing(id: number): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue
             SET status = 'processing', processed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id]
        );
    }


    async markProcessed(id: number): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue 
             SET status = 'processed', processed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id]
        );
    }

    async markFailed(id: number, error: string): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue 
             SET status = 'failed', error_message = $1, retry_count = retry_count + 1
             WHERE id = $2`,
            [error, id]
        );
    }

    async markDead(id: number, error: string): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue
             SET status = 'dead', error_message = $1, processed_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [error, id]
        );
    }

    async getDead(limit: number = 50): Promise<QueueEvent[]> {
        const result = await this.pool.query<QueueEvent>(`
            SELECT * FROM integration_queue
            WHERE status = 'dead'
            ORDER BY processed_at DESC
            LIMIT $1
        `, [limit]);
        return result.rows;
    }

    async resetForRetry(id: number): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue 
             SET status = 'pending', error_message = NULL, processed_at = NULL
             WHERE id = $1`,
            [id]
        );
    }

    async getStats(): Promise<{
        queue: Record<string, number>;
        orders_total: number;
        users_total: number;
        last_24h: { accepted: number; processed: number; failed: number; dead: number };
    }> {
        const queueStats = await this.pool.query(`
            SELECT status, COUNT(*)::int AS cnt
            FROM integration_queue
            GROUP BY status
        `);

        const ordersCount = await this.pool.query('SELECT COUNT(*)::int AS cnt FROM orders');
        const usersCount = await this.pool.query('SELECT COUNT(*)::int AS cnt FROM users');

        const last24h = await this.pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE true) AS accepted,
                COUNT(*) FILTER (WHERE status = 'processed') AS processed,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE status = 'dead') AS dead
            FROM integration_queue
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);

        const queue: Record<string, number> = {};
        for (const row of queueStats.rows) {
            queue[row.status] = Number(row.cnt);
        }

        return {
            queue,
            orders_total: Number(ordersCount.rows[0].cnt),
            users_total: Number(usersCount.rows[0].cnt),
            last_24h: {
                accepted: Number(last24h.rows[0].accepted),
                processed: Number(last24h.rows[0].processed),
                failed: Number(last24h.rows[0].failed),
                dead: Number(last24h.rows[0].dead),
            }
        };
    }

    async addLog(data: {
        queueId?: number;
        level: string;
        message: string;
        metadata?: any;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO integration_logs (queue_id, level, message, metadata)
             VALUES ($1, $2, $3, $4)`,
            [data.queueId || null, data.level, data.message, JSON.stringify(data.metadata || {})]
        );
    }
}
