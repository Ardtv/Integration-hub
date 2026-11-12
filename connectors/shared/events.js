// Зеркало src/contracts/events.ts для коннекторов. Менять только вместе с ним.
const EVENTS = {
    TEST: 'test',
    AMO_DEAL_CHANGED: 'amo.deal.changed',
    AMO_DEAL_DELETED: 'amo.deal.deleted',
    CDEK_ORDER_STATUS: 'cdek.order.status',
    FF_STOCK_UPDATED: 'fulfillment.stock.updated',
    SHIPMENT_WRITEOFF: 'shipment.writeoff',
    SHIPMENT_SALE: 'shipment.sale',
    SHIPMENT_RETURN_IIKO: 'shipment.return.iiko',
    SHIPMENT_RETURN_1C: 'shipment.return.1c'
};
module.exports = { EVENTS };
