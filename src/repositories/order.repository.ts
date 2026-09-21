import { Pool } from 'pg';

export interface Order {
    id: number;
    user_id: number | null;
    status: string;
    currency: string;
    total_amount_minor: number;
    promo_code_id: number | null;
    referrer_id: number | null;
    payment_id: number | null;
    created_at: Date;
    updated_at: Date;
    customer_phone: string;
    customer_email: string | null;
    delivery_address: string | null;
    payment_method: string | null;
    comment: string | null;
    customer_name: string;
}

export class OrderRepository {
    constructor(private pool: Pool) {}

    async getById(id: number): Promise<Order | null> {
        const result = await this.pool.query<Order>(
            'SELECT * FROM orders WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    async create(data: {
        user_id: number | null;
        customer_name: string;
        customer_phone: string;
        customer_email?: string | null;
        delivery_address?: string;
        currency: string;
        total_amount_minor: number;
        status: string;
        comment?: string;
        payment_method?: string;
    }): Promise<Order> {
        const query = `
            INSERT INTO orders (
                user_id, status, currency, total_amount_minor,
                promo_code_id, referrer_id, payment_id,
                customer_phone, customer_email, delivery_address, payment_method,
                comment, customer_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;
        
        const result = await this.pool.query<Order>(query, [
            data.user_id, data.status, data.currency, data.total_amount_minor,
            null, null, null,
            data.customer_phone,
            data.customer_email || null,
            data.delivery_address || null,
            data.payment_method || null,
            data.comment || null,
            data.customer_name
        ]);        
        return result.rows[0];
    }

        async update(id: number, data: {
        customer_name?: string;
        customer_phone?: string;
        customer_email?: string;
        delivery_address?: string;
        currency?: string;
        total_amount_minor?: number;
        status?: string;
        comment?: string;
        payment_method?: string;
    }): Promise<Order> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                fields.push(`${key} = $${i}`);
                values.push(value);
                i++;
            }
        }

        if (fields.length === 0) {
            const current = await this.getById(id);
            if (!current) throw new Error(`Order ${id} not found`);
            return current;
        }

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const query = `UPDATE orders SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`;

        const result = await this.pool.query<Order>(query, values);

        if (result.rows.length === 0) {
            throw new Error(`Order ${id} not found for update`);
        }

        return result.rows[0];
    }

    async findByExternalId(system: string, externalId: string): Promise<Order | null> {
        const query = `
            SELECT o.*
            FROM orders o
            JOIN external_id_mapping eim ON eim.internal_id = o.id
            WHERE eim.external_system = $1 
              AND eim.external_id = $2
              AND eim.internal_table = 'orders'
        `;
        const result = await this.pool.query<Order>(query, [system, externalId]);
        return result.rows[0] || null;
    }
    async updateStatus(id: number, status: string): Promise<Order> {
        const result = await this.pool.query<Order>(
            'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status, id]
        );
        return result.rows[0];
    }
}
