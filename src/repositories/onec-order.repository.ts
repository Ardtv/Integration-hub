import { Pool } from 'pg';

export interface OnecOrder {
    id: number;
    order_id: number | null;
    onec_id: string | null;
    status: string | null;
    total_amount_minor: number | null;
    created_at: Date;
    updated_at: Date;
}

export class OnecOrderRepository {
    constructor(private pool: Pool) {}

    async create(data: {
        order_id?: number;
        onec_id?: string;
        status?: string;
        total_amount_minor?: number;
    }): Promise<OnecOrder> {
        const result = await this.pool.query<OnecOrder>(
            `INSERT INTO onec_orders (order_id, onec_id, status, total_amount_minor, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [
                data.order_id || null,
                data.onec_id || null,
                data.status || null,
                data.total_amount_minor || null
            ]
        );
        return result.rows[0];
    }

    async findByOnecId(onec_id: string): Promise<OnecOrder | null> {
        const result = await this.pool.query<OnecOrder>(
            'SELECT * FROM onec_orders WHERE onec_id = $1 LIMIT 1',
            [onec_id]
        );
        return result.rows[0] || null;
    }
}
