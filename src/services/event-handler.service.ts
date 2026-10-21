import { QueueEvent } from '../repositories/queue.repository';
import { OrderService } from './order.service';
import { QueueRepository } from '../repositories/queue.repository';
import { logger } from '../config/logger';
import { CdekOrderRepository } from '../repositories/cdek-order.repository';
import { FulfillmentOrderRepository } from '../repositories/fulfillment-order.repository';
import { MarketplaceOrderRepository } from '../repositories/marketplace-order.repository';
import { OnecOrderRepository } from '../repositories/onec-order.repository';
import { MoyskladProductRepository } from '../repositories/moysklad-product.repository';

export class EventHandlerService {
    constructor(
        private orderService: OrderService,
        private queueRepo: QueueRepository,
        private cdekOrderRepo: CdekOrderRepository,
        private fulfillmentOrderRepo: FulfillmentOrderRepository,
        private marketplaceOrderRepo: MarketplaceOrderRepository,
        private onecOrderRepo: OnecOrderRepository,
        private moyskladProductRepo: MoyskladProductRepository
    ) {}


    async handle(event: QueueEvent): Promise<void> {
       logger.info({ eventId: event.id, eventType: event.event_type, source: event.source }, 'Processing event')

        try {
          switch (event.source) {
                case 'test':
                    logger.info({ payload: event.payload }, 'Test event processed')
                    return;

                case 'amo':
                    await this.handleAmo(event);
                    return;

                case 'iiko':
                    await this.handleIiko(event);
                    return;

                case 'cdek':
                    await this.handleCdek(event);
                    return;

                case 'fulfillment':
                    await this.handleFulfillment(event);
                    return;

                case 'marketplace':
                    await this.handleMarketplace(event);
                    return;

                case '1c':
                    await this.handle1C(event);
                    return;

                case 'moysklad':
                    await this.handleMoysklad(event);
                    return;

                default:
                    logger.warn({ source: event.source }, 'Unknown source')
                    return;
            }
        } catch (error: any) {
            logger.error({ eventId: event.id, err: error.message }, 'Error processing event')
            throw error;
        }
    }

private async handleAmo(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        if (!payload.order) {
logger.warn({ eventType: event.event_type }, 'Amo event without order payload')
            return;
        }

        const isStatusUpdate = event.event_type === 'deal.status_updated';
        const isDeleted = event.event_type === 'deal.deleted';

        if (isStatusUpdate || isDeleted) {
            if (isStatusUpdate && !payload.order.status) {
                logger.warn('deal.status_updated without status')
                return;
            }

            const existing = await this.orderService.findByExternalId(
                payload.external_system,
                payload.external_id
            );

            if (!existing) {
                logger.warn({ externalSystem: payload.external_system, externalId: payload.external_id }, 'Order not found')
                return;
            }

            const newStatus = isDeleted ? 'cancelled' : payload.order.status;
            await this.orderService.updateStatusOnly(existing.id, newStatus);
            logger.info({ orderId: existing.id, status: newStatus, eventType: event.event_type }, 'Order status updated')
            return;
        }

        const result = await this.orderService.createOrUpdateFromExternal({
            ...payload.order,
            external_id: payload.external_id,
            external_system: payload.external_system || 'amo'
        });

        logger.info({ orderId: result.orderId, isNew: result.isNew }, 'Order processed');

        // Отправляем в IIKO (только новый заказ)
        if (result.isNew) {
            await this.sendOrderToIiko(result.orderId);
        }
    }

    private async sendOrderToIiko(orderId: number): Promise<void> {
        try {
            const { sendOrderToIiko } = require('../../connectors/iiko/send-order');
            const order = await this.orderService.getOrderWithItems(orderId);

            if (!order || !order.items || order.items.length === 0) {
                logger.warn({ orderId }, 'Order has no items — skipping IIKO');
                return;
            }

            const result = await sendOrderToIiko(order);

            if (result.orderInfo?.id) {
                await this.orderService.setIikoOrderId(orderId, result.orderInfo.id);
                logger.info({ orderId, iikoOrderId: result.orderInfo.id }, 'Order sent to IIKO');
            }
        } catch (e: any) {
            logger.error({ orderId, err: e.message }, 'Failed to send order to IIKO');
        }
    }
    private async handleIiko(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        logger.info({ eventType: event.event_type }, 'IIKO event received');

        switch (event.event_type) {
            case 'iiko.order.created':
                logger.info({ payload }, 'IIKO order created');
                break;

            case 'iiko.order.status_updated':
                logger.info({ payload }, 'IIKO order status updated');
                break;

            case 'iiko.order.cancelled':
                logger.info({ payload }, 'IIKO order cancelled');
                break;

            case 'iiko.stop_list.updated':
                logger.info({ payload }, 'IIKO stop-list updated');
                break;

            case 'iiko.menu.synced':
                logger.info({ payload }, 'IIKO menu synced');
                break;

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown IIKO event type');
        }
    }

        private async handleCdek(event: QueueEvent): Promise<void> {
        const payload = event.payload;
        logger.info({ eventType: event.event_type, payload }, 'CDEK event received');

        switch (event.event_type) {
            case 'cdek.order.created': {
                if (payload.cdek_uuid) {
                    const existing = await this.cdekOrderRepo.findByUuid(payload.cdek_uuid);
                    if (existing) {
                        logger.info({ cdekUuid: payload.cdek_uuid }, 'CDEK order already exists — skip');
                        break;
                    }
                }

                await this.cdekOrderRepo.create({
                    order_id: payload.order_id,
                    cdek_uuid: payload.cdek_uuid,
                    cdek_number: payload.cdek_number,
                    status: payload.status || 'CREATED',
                    status_code: payload.status_code || '1',
                    delivery_sum: payload.delivery_sum,
                    city: payload.city,
                    address: payload.address
                });

                logger.info({ cdekUuid: payload.cdek_uuid }, 'CDEK order created');
                break;
            }

            case 'cdek.order.status_updated': {
                if (!payload.cdek_uuid || !payload.status) {
                    logger.warn({ payload }, 'CDEK status_updated without uuid/status');
                    break;
                }

                const updated = await this.cdekOrderRepo.updateStatus(
                    payload.cdek_uuid,
                    payload.status,
                    payload.status_code || ''
                );

                if (updated) {
                    logger.info({ cdekUuid: payload.cdek_uuid, status: payload.status }, 'CDEK status updated');
                } else {
                    logger.warn({ cdekUuid: payload.cdek_uuid }, 'CDEK order not found for status update');
                }
                break;
            }

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown CDEK event');
        }
    }
        private async handleFulfillment(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        switch (event.event_type) {
            case 'fulfillment.order.ready': {
                const existing = await this.fulfillmentOrderRepo.findByFulfillmentId(payload.fulfillment_id);
                if (existing) {
                    logger.info({ fulfillmentId: payload.fulfillment_id }, 'Fulfillment order already exists — skip');
                    return;
                }

                await this.fulfillmentOrderRepo.create({
                    fulfillment_id: payload.fulfillment_id,
                    status: payload.status,
                    status_code: payload.status_code,
                    warehouse: payload.warehouse,
                    order_id: payload.order_id
                });
                logger.info({ fulfillmentId: payload.fulfillment_id }, 'Fulfillment order created');
                break;
            }

            case 'fulfillment.order.status_updated': {
                const updated = await this.fulfillmentOrderRepo.updateStatus(
                    payload.fulfillment_id,
                    payload.status,
                    payload.status_code
                );

                if (updated) {
                    logger.info({ fulfillmentId: payload.fulfillment_id, status: payload.status }, 'Fulfillment order status updated');
                } else {
                    logger.warn({ fulfillmentId: payload.fulfillment_id }, 'Fulfillment order not found');
                }
                break;
            }

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown fulfillment event');
        }
    }

    private async handleMarketplace(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        switch (event.event_type) {
            case 'marketplace.order.created':
            case 'marketplace.order.updated': {
                await this.marketplaceOrderRepo.create({
                    marketplace: payload.marketplace,
                    marketplace_order_id: payload.order_id,
                    status: payload.status,
                    total_amount_minor: payload.total_amount_minor,
                    currency: payload.currency,
                    order_id: payload.internal_order_id
                });
                logger.info({ marketplace: payload.marketplace, orderId: payload.order_id }, 'Marketplace order saved');
                break;
            }

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown marketplace event');
        }
    }

    private async handle1C(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        switch (event.event_type) {
            case '1c.order.created': {
                const existing = await this.onecOrderRepo.findByOnecId(payload.onec_id);
                if (existing) {
                    logger.info({ onecId: payload.onec_id }, '1C order already exists — skip');
                    return;
                }

                await this.onecOrderRepo.create({
                    onec_id: payload.onec_id,
                    status: payload.status,
                    total_amount_minor: payload.total_amount_minor,
                    order_id: payload.order_id
                });
                logger.info({ onecId: payload.onec_id }, '1C order created');
                break;
            }

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown 1C event');
        }
    }

    private async handleMoysklad(event: QueueEvent): Promise<void> {
        const payload = event.payload;

        switch (event.event_type) {
            case 'moysklad.product.updated':
            case 'moysklad.product.created': {
                await this.moyskladProductRepo.upsert({
                    external_id: payload.product_id,
                    name: payload.name,
                    sku: payload.sku,
                    price_minor: payload.price_minor,
                    stock: payload.stock
                });
                logger.info({ productId: payload.product_id }, 'MoySklad product synced');
                break;
            }

            default:
                logger.warn({ eventType: event.event_type }, 'Unknown MoySklad event');
        }
    }
}

