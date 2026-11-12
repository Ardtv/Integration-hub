import { HubConfig } from '../config/config';
import { AmoDeal } from '../gateways/types';
import { ProductMapRow } from '../store/store';
import { ShipmentIntent, normalizePhone } from './intent';

const COUNTRY_CODE = { KZ: 'KZ', RU: 'RU' } as const;

/** Куда доставлять: ПВЗ по коду либо адрес до двери. */
export function buildDestination(intent: ShipmentIntent): Record<string, any> {
    if (intent.deliveryType === 'pvz') return { delivery_point: intent.pvzCode };
    return {
        to_location: {
            country_code: intent.country ? COUNTRY_CODE[intent.country] : undefined,
            city: intent.city,
            address: intent.address
        }
    };
}

/**
 * Тело заказа для API СДЭК v2 (POST /orders).
 * Наложенный платёж: стоимость каждой позиции передаётся в payment.value, то есть
 * получатель платит сумму сделки при получении.
 *
 * Допущение: параметры, которые превращают заказ в заявку на фулфилмент, заранее
 * неизвестны. Они задаются в CDEK_ORDER_EXTRA_JSON и накладываются поверх тела.
 */
export function buildCdekOrder(deal: AmoDeal, intent: ShipmentIntent, map: Map<number, ProductMapRow>, cfg: HubConfig): Record<string, any> {
    const c = cfg.cdek;
    let totalWeight = 0;
    const items = deal.items.map(it => {
        const m = map.get(it.amo_product_id);
        const weight = m?.weight_g || c.defaultWeightG;
        totalWeight += weight * it.quantity;
        const price = it.price_minor / 100;
        return {
            name: it.name || `Товар ${it.amo_product_id}`,
            ware_key: m?.cdek_sku || it.sku || String(it.amo_product_id),
            payment: { value: price },
            cost: price,
            weight,
            amount: it.quantity
        };
    });

    const body: Record<string, any> = {
        type: 1,
        number: String(deal.id),
        tariff_code: intent.deliveryType === 'pvz' ? c.tariffPvz : c.tariffDoor,
        comment: `amoCRM сделка ${deal.id}`,
        recipient: {
            name: deal.contact.name || deal.name || 'Получатель',
            phones: [{ number: normalizePhone(deal.contact.phone) }]
        },
        ...buildDestination(intent),
        packages: [{
            number: `${deal.id}-1`,
            weight: Math.max(1, Math.round(totalWeight)),
            length: c.box.length,
            width: c.box.width,
            height: c.box.height,
            items
        }]
    };
    if (c.shipmentPoint) body.shipment_point = c.shipmentPoint;
    else if (Object.keys(c.fromLocation).length) body.from_location = c.fromLocation;

    const extraCountry = intent.country ? c.extraByCountry[intent.country] : {};
    return { ...body, ...c.extra, ...extraCountry };
}
