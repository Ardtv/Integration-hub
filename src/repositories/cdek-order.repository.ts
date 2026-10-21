import { Pool } from 'pg';

export interface CdekOrder {
    id: number;
    order_id: number | null;
    cdek_uuid: string | null;
    cdek_number: string | null;
    status: string | null;
    status_code: string | null;
    delivery_sum: number | null;
    city: string | null;
    address: string | null;
    created_at: Date;
    updated_at: Date;
}

export class CdekOrderRepository {
    constructor(private pool: Pool) {}

    async create(data: {
        order_id?: number;
        cdek_uuid?: string;
        cdek_number?: string;
        status?: string;
        status_code?: string;
        delivery_sum?: number;
        city?: string;
        address?: string;
    }): Promise<CdekOrder> {
        const result = await this.pool.query<CdekOrder>(
            `INSERT INTO cdek_orders
             (order_id, cdek_uuid, cdek_number, status, status_code, delivery_sum, city, address, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
             RETURNING *`,
            [
                data.order_id || null,
                data.cdek_uuid || null,
                data.cdek_number || null,
                data.status || null,
                data.status_code || null,
                data.delivery_sum || null,
                data.city || null,
                data.address || null
            ]
        );
        return result.rows[0];
    }

    async updateStatus(cdek_uuid: string, status: string, status_code: string): Promise<CdekOrder | null> {
        const result = await this.pool.query<CdekOrder>(
            `UPDATE cdek_orders
             SET status = $1, status_code = $2, updated_at = NOW()
             WHERE cdek_uuid = $3
             RETURNING *`,
            [status, status_code, cdek_uuid]
        );
        return result.rows[0] || null;
    }

    async findByUuid(cdek_uuid: string): Promise<CdekOrder | null> {
        const result = await this.pool.query<CdekOrder>(
            'SELECT * FROM cdek_orders WHERE cdek_uuid = $1 LIMIT 1',
            [cdek_uuid]
        );
        return result.rows[0] || null;
    }
}
