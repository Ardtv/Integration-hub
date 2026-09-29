import { QueueEvent } from '../repositories/queue.repository';
import { OrderService } from './order.service';
import { QueueRepository } from '../repositories/queue.repository';
import { logger } from '../config/logger';

export class EventHandlerService {
    constructor(
        private orderService: OrderService,
        private queueRepo: QueueRepository
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
                    logger.info({ eventType: event.event_type }, 'CDEK event')
                    return;

                case 'fulfillment':
                    logger.info({ eventType: event.event_type }, 'Fulfillment event')
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

        logger.info({ orderId: result.orderId, isNew: result.isNew }, 'Order processed')
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
}
