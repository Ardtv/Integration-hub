import { Pool } from 'pg';

export interface MarketplaceOrder {
    id: number;
    order_id: number | null;
    marketplace: string;
    marketplace_order_id: string | null;
    status: string | null;
    total_amount_minor: number | null;
    currency: string | null;
    created_at: Date;
    updated_at: Date;
}

export class MarketplaceOrderRepository {
    constructor(private pool: Pool) {}

    async create(data: {
        order_id?: number;
        marketplace: string;
        marketplace_order_id?: string;
        status?: string;
        total_amount_minor?: number;
        currency?: string;
    }): Promise<MarketplaceOrder> {
        const result = await this.pool.query<MarketplaceOrder>(
            `INSERT INTO marketplace_orders
             (order_id, marketplace, marketplace_order_id, status, total_amount_minor, currency, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (marketplace, marketplace_order_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 total_amount_minor = EXCLUDED.total_amount_minor,
                 updated_at = NOW()
             RETURNING *`,
            [
                data.order_id || null,
                data.marketplace,
                data.marketplace_order_id || null,
                data.status || null,
                data.total_amount_minor || null,
                data.currency || null
            ]
        );
        return result.rows[0];
    }

    async findByMarketplaceOrderId(marketplace: string, marketplace_order_id: string): Promise<MarketplaceOrder | null> {
        const result = await this.pool.query<MarketplaceOrder>(
            'SELECT * FROM marketplace_orders WHERE marketplace = $1 AND marketplace_order_id = $2 LIMIT 1',
            [marketplace, marketplace_order_id]
        );
        return result.rows[0] || null;
    }
}
