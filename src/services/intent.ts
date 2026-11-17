import crypto from 'crypto';
import { HubConfig } from '../config/config';
import { AmoDeal } from '../gateways/types';

export interface ShipmentIntent {
    method: 'cdek' | 'karaganda' | null;
    country: 'KZ' | 'RU' | null;
    deliveryType: 'door' | 'pvz' | null;
    city: string | null;
    address: string | null;
    pvzCode: string | null;
    hash: string;
}

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase().replace(/ё/g, 'е');

// Значения списков сравниваются по тексту, а не по ID вариантов:
// так настройка не ломается, если менеджер пересоздаст вариант в amo.
export function parseMethod(v: string | null | undefined): ShipmentIntent['method'] {
    const s = norm(v);
    if (!s) return null;
    if (s.includes('сдэк') || s.includes('сдек') || s.includes('cdek')) return 'cdek';
    if (s.includes('караганд') || s.includes('b2b') || s.includes('karagand')) return 'karaganda';
    return null;
}
export function parseCountry(v: string | null | undefined): ShipmentIntent['country'] {
    const s = norm(v);
    if (!s) return null;
    if (s.includes('казах') || s === 'kz' || s === 'кз') return 'KZ';
    if (s.includes('росс') || s === 'ru' || s === 'рф') return 'RU';
    return null;
}
export function parseDeliveryType(v: string | null | undefined): ShipmentIntent['deliveryType'] {
    const s = norm(v);
    if (!s) return null;
    if (s.includes('двер') || s.includes('курьер') || s === 'door') return 'door';
    if (s.includes('пвз') || s.includes('пункт') || s.includes('постамат') || s === 'pvz') return 'pvz';
    return null;
}

/** Город из адреса одной строкой: «Город Ерейментау улица …», «г. Астана, ул. …». */
export function cityFromAddress(address: string | null | undefined): string | null {
    const m = /(?:^|[\s,;])(?:г\.|гор\.|город)\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\-]*)/i.exec(address || '');
    return m ? m[1].trim() : null;
}

export function readIntent(deal: AmoDeal, cfg: HubConfig): ShipmentIntent {
    const f = cfg.amo.fields;
    const d = cfg.amo.defaults;
    const get = (id: number | null) => (id ? (deal.fields[String(id)] || '').trim() || null : null);

    // Способ отправки: поле (если настроено) → склад из списка «ручных» → самовывоз → значение по умолчанию.
    // В воронке «Доставка» способ задаёт сам этап («СДЕК ФФ»), поэтому поля обычно нет.
    let method = parseMethod(get(f.method));
    const warehouse = norm(get(f.warehouse));
    if (warehouse && cfg.amo.manualWarehouses.some(w => warehouse.includes(norm(w)))) method = 'karaganda';
    if (!method && norm(get(f.deliveryMode)).includes('самовывоз')) method = 'karaganda';
    if (!method) method = d.method;

    const address = get(f.address);
    const base = {
        method,
        country: parseCountry(get(f.country)) || d.country,
        deliveryType: parseDeliveryType(get(f.deliveryType)) || d.deliveryType,
        city: get(f.city) || cityFromAddress(address),
        address,
        pvzCode: get(f.pvz)
    };
    const hash = crypto.createHash('sha256')
        .update([base.method, base.country, base.deliveryType, norm(base.city), norm(base.address), norm(base.pvzCode)].join('|'))
        .digest('hex');
    return { ...base, hash };
}

export function normalizePhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length === 10) return `+7${digits}`;
    if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
    return `+${digits}`;
}
