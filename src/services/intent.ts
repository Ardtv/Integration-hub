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

export function readIntent(deal: AmoDeal, cfg: HubConfig): ShipmentIntent {
    const f = cfg.amo.fields;
    const get = (id: number | null) => (id ? (deal.fields[String(id)] || '').trim() || null : null);
    const base = {
        method: parseMethod(get(f.method)),
        country: parseCountry(get(f.country)),
        deliveryType: parseDeliveryType(get(f.deliveryType)),
        city: get(f.city),
        address: get(f.address),
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
