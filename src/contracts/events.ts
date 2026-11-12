// Единый контракт событий хаба. Коннекторы (JS) используют зеркало
// connectors/shared/events.js; тест tests/contract.test.js проверяет, что списки совпадают.

export const EVENTS = {
    TEST: 'test',
    AMO_DEAL_CHANGED: 'amo.deal.changed',
    AMO_DEAL_DELETED: 'amo.deal.deleted',
    CDEK_ORDER_STATUS: 'cdek.order.status',
    FF_STOCK_UPDATED: 'fulfillment.stock.updated',
    SHIPMENT_WRITEOFF: 'shipment.writeoff',
    SHIPMENT_SALE: 'shipment.sale',
    SHIPMENT_RETURN_IIKO: 'shipment.return.iiko',
    SHIPMENT_RETURN_1C: 'shipment.return.1c'
} as const;

export type EventType = typeof EVENTS[keyof typeof EVENTS];

export interface AmoDealPayload { deal_id: number; kind: 'add' | 'update' | 'status' | 'delete' | 'manual' }
export interface CdekStatusPayload { cdek_uuid: string; cdek_number?: string | null; code: string; status_at?: string | null }
export interface FfStockPayload {
    external_id: string;
    product: { name?: string | null; sku?: string | null; article?: string | null; stock?: number; price_minor?: number; currency?: string };
}
export interface ShipmentDocPayload { deal_id: number }

/** Проверка формы события на входе в хаб. Возвращает текст ошибки или null. */
export function validateEvent(eventType: string, payload: any): string | null {
    if (!payload || typeof payload !== 'object') return 'payload должен быть объектом';
    const num = (v: any) => Number.isFinite(Number(v)) && Number(v) > 0;
    switch (eventType) {
        case EVENTS.TEST:
            return null;
        case EVENTS.AMO_DEAL_CHANGED:
        case EVENTS.AMO_DEAL_DELETED:
        case EVENTS.SHIPMENT_WRITEOFF:
        case EVENTS.SHIPMENT_SALE:
        case EVENTS.SHIPMENT_RETURN_IIKO:
        case EVENTS.SHIPMENT_RETURN_1C:
            return num(payload.deal_id) ? null : 'нужен числовой deal_id';
        case EVENTS.CDEK_ORDER_STATUS:
            if (!payload.cdek_uuid) return 'нужен cdek_uuid';
            if (!payload.code) return 'нужен code (статус СДЭК)';
            return null;
        case EVENTS.FF_STOCK_UPDATED:
            return payload.external_id && payload.product ? null : 'нужны external_id и product';
        default:
            return `неизвестный тип события: ${eventType}`;
    }
}

/** Ключи идемпотентности документов по сделке (из ТЗ Этапа 2.1). */
export const opKey = {
    shipment: (dealId: number) => `deal:${dealId}:shipment`,
    writeoff: (dealId: number) => `deal:${dealId}:writeoff`,
    sale: (dealId: number) => `deal:${dealId}:sale`,
    returnIiko: (dealId: number) => `deal:${dealId}:return:iiko`,
    return1c: (dealId: number) => `deal:${dealId}:return:1c`
};
