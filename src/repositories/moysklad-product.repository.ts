import { Pool } from 'pg';

export interface MoyskladProduct {
    id: number;
    external_id: string | null;
    name: string | null;
    sku: string | null;
    price_minor: number | null;
    stock: number | null;
    created_at: Date;
    updated_at: Date;
}

export class MoyskladProductRepository {
    constructor(private pool: Pool) {}

    async upsert(data: {
        external_id: string;
        name?: string;
        sku?: string;
        price_minor?: number;
        stock?: number;
    }): Promise<MoyskladProduct> {
        const result = await this.pool.query<MoyskladProduct>(
            `INSERT INTO moysklad_products (external_id, name, sku, price_minor, stock, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             ON CONFLICT (external_id) DO UPDATE SET
                 name = EXCLUDED.name,
                 sku = EXCLUDED.sku,
                 price_minor = EXCLUDED.price_minor,
                 stock = EXCLUDED.stock,
                 updated_at = NOW()
             RETURNING *`,
            [
                data.external_id,
                data.name || null,
                data.sku || null,
                data.price_minor || null,
                data.stock || null
            ]
        );
        return result.rows[0];
    }
}
