import { EVENTS } from '../contracts/events';
import { QueueEvent, Store } from '../store/store';
import { Documents } from '../services/documents';
import { Orchestrator } from '../services/orchestrator';

/** Маршрутизация событий очереди. Возвращает короткий итог для журнала. */
export class EventHandler {
    constructor(private store: Store, private orchestrator: Orchestrator, private documents: Documents) {}

    async handle(event: QueueEvent): Promise<string> {
        const p = event.payload || {};
        switch (event.event_type) {
            case EVENTS.TEST:
                return 'тестовое событие';
            case EVENTS.AMO_DEAL_CHANGED:
                return this.orchestrator.handleDealChanged(Number(p.deal_id));
            case EVENTS.AMO_DEAL_DELETED:
                return 'удаление сделки: отправка и документы не изменяются';
            case EVENTS.CDEK_ORDER_STATUS:
                return this.orchestrator.handleCdekStatus(p);
            case EVENTS.SHIPMENT_WRITEOFF:
                return this.documents.writeoff(Number(p.deal_id));
            case EVENTS.SHIPMENT_SALE:
                return this.documents.sale(Number(p.deal_id));
            case EVENTS.SHIPMENT_RETURN_IIKO:
                return this.documents.returnIiko(Number(p.deal_id));
            case EVENTS.SHIPMENT_RETURN_1C:
                return this.documents.return1c(Number(p.deal_id));
            case EVENTS.FF_STOCK_UPDATED:
                await this.store.upsertFfOffer({ external_id: String(p.external_id), ...p.product });
                return 'остаток фулфилмента обновлён';
            default:
                throw new Error(`Неизвестный тип события: ${event.event_type}`);
        }
    }
}
