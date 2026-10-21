import { Pool } from 'pg';

export interface FulfillmentOrder {
    id: number;
    order_id: number | null;
    fulfillment_id: string | null;
    status: string | null;
    status_code: string | null;
    warehouse: string | null;
    created_at: Date;
    updated_at: Date;
}

export class FulfillmentOrderRepository {
    constructor(private pool: Pool) {}

    async create(data: {
        order_id?: number;
        fulfillment_id?: string;
        status?: string;
        status_code?: string;
        warehouse?: string;
    }): Promise<FulfillmentOrder> {
        const result = await this.pool.query<FulfillmentOrder>(
            `INSERT INTO fulfillment_orders (order_id, fulfillment_id, status, status_code, warehouse, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
            [
                data.order_id || null,
                data.fulfillment_id || null,
                data.status || null,
                data.status_code || null,
                data.warehouse || null
            ]
        );
        return result.rows[0];
    }

    async updateStatus(fulfillment_id: string, status: string, status_code: string): Promise<FulfillmentOrder | null> {
        const result = await this.pool.query<FulfillmentOrder>(
            `UPDATE fulfillment_orders SET status = $1, status_code = $2, updated_at = NOW()
             WHERE fulfillment_id = $3 RETURNING *`,
            [status, status_code, fulfillment_id]
        );
        return result.rows[0] || null;
    }

    async findByFulfillmentId(fulfillment_id: string): Promise<FulfillmentOrder | null> {
        const result = await this.pool.query<FulfillmentOrder>(
            'SELECT * FROM fulfillment_orders WHERE fulfillment_id = $1 LIMIT 1',
            [fulfillment_id]
        );
        return result.rows[0] || null;
    }
}
