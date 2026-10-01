import { OrderRepository } from '../repositories/order.repository';
import { MappingRepository } from '../repositories/mapping.repository';
import { Pool } from 'pg';
import { logger } from '../config/logger';
import { OrderItemRepository, ExternalOrderItemInput } from '../repositories/order-item.repository';

export class OrderService {
    constructor(
        private orderRepo: OrderRepository,
        private mappingRepo: MappingRepository,
        private orderItemRepo: OrderItemRepository,
        private pool: Pool
    ) {}
    async getOrderWithItems(orderId: number): Promise<any> {
        const order = await this.orderRepo.getById(orderId);
        if (!order) return null;

        // Получаем items из external_order_items
        const itemsResult = await this.pool.query(
            `SELECT id, external_id, name, quantity, price_minor
             FROM external_order_items WHERE order_id = $1`,
            [orderId]
        );

        return {
            id: order.id,
            customer_phone: order.customer_phone,
            customer_name: order.customer_name,
            delivery_address: order.delivery_address,
            comment: order.comment,
            items: itemsResult.rows.map(item => ({
                product_id: item.id,
                quantity: item.quantity
            }))
        };
    }

    async setIikoOrderId(orderId: number, iikoOrderId: string): Promise<void> {
        await this.pool.query(
            `UPDATE orders SET iiko_order_id = $1, updated_at = NOW() WHERE id = $2`,
            [iikoOrderId, orderId]
        );
    }

    async createOrUpdateFromExternal(data: {
        customer_name: string;
        customer_phone: string;
        customer_email?: string;
        delivery_address?: string;
        currency: string;
        total_amount_minor: number;
        status?: string;
        comment?: string;
        payment_method?: string;
        items?: ExternalOrderItemInput[];
        external_id: string;
        external_system: string;
    }): Promise<{ orderId: number; isNew: boolean }> {

        // 1. Проверяем, есть ли уже заказ по внешнему ID
        const existing = await this.orderRepo.findByExternalId(
            data.external_system,
            data.external_id
        );

        if (existing) {
            await this.orderRepo.update(existing.id, {
                customer_name: data.customer_name,
                customer_phone: data.customer_phone,
                customer_email: data.customer_email,
                delivery_address: data.delivery_address,
                currency: data.currency,
                total_amount_minor: data.total_amount_minor,
                status: data.status,
                comment: data.comment,
                payment_method: data.payment_method,
            });
            if (data.items && data.items.length > 0) {
                await this.orderItemRepo.replaceForOrder(existing.id, data.items);
            }

            return { orderId: existing.id, isNew: false };
        }

        // 2. Находим или создаём пользователя
        const phone = this.normalizePhone(data.customer_phone);
        const identifier = phone || `unknown_${data.external_id}`;
        const userId = await this.findOrCreateUser(identifier, data.customer_name);

        // 3. Создаём заказ
        const order = await this.orderRepo.create({
            user_id: userId,
            customer_name: data.customer_name,
            customer_phone: phone ?? "",
            customer_email: data.customer_email,
            delivery_address: data.delivery_address,
            currency: data.currency,
            total_amount_minor: data.total_amount_minor,
            status: data.status || 'new',
            comment: data.comment,
            payment_method: data.payment_method
        });

        // 4. Сохраняем связь
        await this.mappingRepo.save({
            internalTable: 'orders',
            internalId: order.id,
            externalSystem: data.external_system,
            externalId: data.external_id
        });
        if (data.items && data.items.length > 0) {
            await this.orderItemRepo.replaceForOrder(order.id, data.items);
        }
        return { orderId: order.id, isNew: true };
    }
    async findByExternalId(externalSystem: string, externalId: string) {
        return this.orderRepo.findByExternalId(externalSystem, externalId);
    }

    async updateStatusOnly(orderId: number, status: string): Promise<void> {
        await this.orderRepo.updateStatus(orderId, status);
    }
    // "+7 (999) 123-45-67" / "8 999 1234567" -> "79991234567"; мусор ("unknown_123", "") -> null
    private normalizePhone(raw?: string): string | null {
        if (!raw) return null;
        let digits = raw.replace(/\D/g, "");
        if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
        return digits.length >= 10 && digits.length <= 15 ? digits : null;
    }

    private async findOrCreateUser(identifier: string, name: string): Promise<number> {
        if (!identifier.startsWith('unknown_')) {
            const existingUser = await this.pool.query(
                'SELECT id FROM users WHERE phone = $1 LIMIT 1',
                [identifier]
            );

            if (existingUser.rows.length > 0) {
                logger.info({ userId: existingUser.rows[0].id, phone: identifier }, 'Existing user found');
                return existingUser.rows[0].id;
            }
        }

        let pseudoTelegramId = -Math.abs(this.hashCode(identifier));

        for (let attempt = 0; attempt < 5; attempt++) {
            const busy = await this.pool.query(
                'SELECT 1 FROM users WHERE telegram_id = $1 LIMIT 1',
                [pseudoTelegramId]
            );
            if (busy.rows.length === 0) break;
            pseudoTelegramId = pseudoTelegramId - 1;
        }

        logger.info({ identifier, name, pseudoTelegramId }, 'Creating user');

        const phoneValue = identifier.startsWith('unknown_') ? null : identifier;

        const newUser = await this.pool.query(
            `INSERT INTO users (telegram_id, phone, first_name, language, created_at, updated_at)
             VALUES ($1, $2, $3, 'ru', NOW(), NOW())
             RETURNING id`,
            [pseudoTelegramId, phoneValue, name]
        );

        logger.info({ userId: newUser.rows[0].id }, 'User created');
        return newUser.rows[0].id;
    }

    private hashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash;
    }
}
