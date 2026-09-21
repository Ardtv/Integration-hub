import { Pool } from 'pg';

export interface ExternalOrderItem {
    id: number;
    order_id: number;
    external_id: string | null;
    name: string | null;
    quantity: number;
    price_minor: number;
    created_at: Date;
}

export interface ExternalOrderItemInput {
    external_id?: string | null;
    name?: string | null;
    quantity?: number;
    price_minor?: number;
}

export class OrderItemRepository {
    constructor(private pool: Pool) {}

    async replaceForOrder(orderId: number, items: ExternalOrderItemInput[]): Promise<void> {
        await this.pool.query('DELETE FROM external_order_items WHERE order_id = $1', [orderId]);

        for (const item of items) {
            await this.pool.query(
                `INSERT INTO external_order_items (order_id, external_id, name, quantity, price_minor)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    orderId,
                    item.external_id || null,
                    item.name || null,
                    item.quantity || 1,
                    item.price_minor || 0
                ]
            );
        }
    }

    async getByOrderId(orderId: number): Promise<ExternalOrderItem[]> {
        const result = await this.pool.query<ExternalOrderItem>(
            'SELECT * FROM external_order_items WHERE order_id = $1 ORDER BY id',
            [orderId]
        );
        return result.rows;
    }
}
