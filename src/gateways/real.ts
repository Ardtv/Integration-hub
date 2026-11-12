import { HubConfig } from '../config/config';
import { Store } from '../store/store';
import { logger } from '../config/logger';
import { AmoDeal, AmoDealItem, AmoGateway, CdekGateway, CdekOrderInfo, Gateways, IikoGateway, OnecGateway, Alerter } from './types';

/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * Обёртка над любым вызовом на запись.
 * test: вызов не выполняется, в outbound_calls остаётся строка со статусом dry_run и телом запроса.
 * live: вызов выполняется, результат или ошибка записываются.
 */
export class Outbound {
    constructor(private store: Store, private cfg: HubConfig) {}

    async write<T>(system: string, action: string, dealId: number | null, request: any, call: () => Promise<T>, dryResult: T): Promise<T> {
        if (this.cfg.mode !== 'live') {
            await this.store.recordOutbound({ system, action, dealId, mode: 'test', status: 'dry_run', request, response: dryResult as any });
            logger.info({ system, action, dealId }, 'Тестовый режим: вызов не выполнен');
            return dryResult;
        }
        try {
            const res = await call();
            await this.store.recordOutbound({ system, action, dealId, mode: 'live', status: 'ok', request, response: res as any });
            return res;
        } catch (e: any) {
            await this.store.recordOutbound({ system, action, dealId, mode: 'live', status: 'failed', request, error: e?.message || String(e) });
            throw e;
        }
    }
}

function firstValue(entity: any, code: string): string | null {
    const f = (entity?.custom_fields_values || []).find((x: any) => x.field_code === code);
    const v = f?.values?.[0]?.value;
    return v === undefined || v === null || v === '' ? null : String(v);
}

export class RealAmoGateway implements AmoGateway {
    private client: any;
    constructor(private cfg: HubConfig, private out: Outbound, client?: any) {
        if (client) this.client = client;
    }

    private api(): any {
        if (!this.client) {
            const AmoClient = require('../../connectors/amo/amo-client');
            this.client = new AmoClient(this.cfg.amo.token, this.cfg.amo.domain);
        }
        return this.client;
    }

    async getDeal(dealId: number): Promise<AmoDeal | null> {
        const lead = await this.api().getDeal(dealId);
        if (!lead || !lead.id) return null;

        const fields: Record<string, string> = {};
        for (const f of lead.custom_fields_values || []) {
            const v = f?.values?.[0]?.value;
            if (v !== undefined && v !== null && v !== '') fields[String(f.field_id)] = String(v);
        }

        let contact = { name: null as string | null, phone: null as string | null, email: null as string | null };
        const contacts = lead._embedded?.contacts || [];
        const main = contacts.find((c: any) => c.is_main) || contacts[0];
        if (main?.id) {
            const c = await this.api().getContact(main.id);
            contact = { name: c?.name || null, phone: firstValue(c, 'PHONE'), email: firstValue(c, 'EMAIL') };
        }

        const items: AmoDealItem[] = [];
        for (const el of lead._embedded?.catalog_elements || []) {
            const catalogId = el.metadata?.catalog_id;
            const quantity = Number(el.metadata?.quantity) || 1;
            let name: string | null = null;
            let sku: string | null = null;
            let price = 0;
            if (catalogId) {
                const full = await this.api().getCatalogElement(catalogId, el.id);
                name = full?.name || null;
                sku = firstValue(full, 'SKU');
                price = Number(firstValue(full, 'PRICE')) || 0;
            }
            items.push({ amo_product_id: Number(el.id), name, sku, quantity, price_minor: Math.round(price * 100) });
        }

        return {
            id: Number(lead.id),
            name: lead.name || null,
            price_minor: Math.round((Number(lead.price) || 0) * 100),
            status_id: lead.status_id ? Number(lead.status_id) : null,
            pipeline_id: lead.pipeline_id ? Number(lead.pipeline_id) : null,
            responsible_user_id: lead.responsible_user_id ? Number(lead.responsible_user_id) : null,
            updated_at: lead.updated_at ? Number(lead.updated_at) : null,
            fields,
            contact,
            items
        };
    }

    async setField(dealId: number, fieldId: number, value: string): Promise<void> {
        await this.out.write('amo', 'set_field', dealId, { fieldId, value }, async () => { await this.api().setField(dealId, fieldId, value); return null; }, null);
    }
    async setStage(dealId: number, statusId: number, pipelineId?: number | null): Promise<void> {
        await this.out.write('amo', 'set_stage', dealId, { statusId, pipelineId }, async () => { await this.api().setStage(dealId, statusId, pipelineId); return null; }, null);
    }
    async addNote(dealId: number, text: string): Promise<void> {
        await this.out.write('amo', 'add_note', dealId, { text }, async () => { await this.api().addNote(dealId, text); return null; }, null);
    }
    async addTask(dealId: number, text: string, responsibleUserId?: number | null): Promise<void> {
        await this.out.write('amo', 'add_task', dealId, { text, responsibleUserId }, async () => { await this.api().addTask(dealId, text, responsibleUserId); return null; }, null);
    }
}

function toOrderInfo(data: any): CdekOrderInfo | null {
    const entity = data?.entity;
    if (!entity?.uuid) return null;
    return { uuid: entity.uuid, cdek_number: entity.cdek_number || null, statuses: entity.statuses || [] };
}

export class RealCdekGateway implements CdekGateway {
    constructor(private cfg: HubConfig, private out: Outbound, private client: any = null) {}
    private api(): any {
        if (!this.client) this.client = require('../../connectors/cdek/cdek-client');
        return this.client;
    }

    async createOrder(dealId: number, body: Record<string, any>): Promise<{ uuid: string }> {
        return this.out.write('cdek', 'create_order', dealId, body, async () => {
            const res = await this.api().createOrder(body);
            const uuid = res?.entity?.uuid;
            if (!uuid) throw new Error(`СДЭК не вернул uuid заказа: ${JSON.stringify(res?.requests || res).slice(0, 500)}`);
            return { uuid: String(uuid) };
        }, { uuid: `dry-${dealId}` });
    }

    async updateOrder(dealId: number, body: Record<string, any>): Promise<void> {
        await this.out.write('cdek', 'update_order', dealId, body, async () => { await this.api().updateOrder(body); return null; }, null);
    }

    async findByImNumber(imNumber: string): Promise<CdekOrderInfo | null> {
        if (this.cfg.mode !== 'live') return null;
        return toOrderInfo(await this.api().getOrderByImNumber(imNumber));
    }

    async getOrder(uuid: string): Promise<CdekOrderInfo | null> {
        if (this.cfg.mode !== 'live' || uuid.startsWith('dry-')) return null;
        return toOrderInfo(await this.api().getOrder(uuid));
    }
}

export class RealIikoGateway implements IikoGateway {
    constructor(private out: Outbound, private client: any = null) {}
    private api(): any {
        if (!this.client) this.client = require('../../connectors/iiko/iiko-client');
        return this.client;
    }
    async createWriteoff(dealId: number, body: Record<string, any>): Promise<{ id: string | null }> {
        return this.out.write('iiko', 'create_writeoff', dealId, body, async () => {
            const res = await this.api().createWriteoffDocument(body);
            return { id: res?.documentId || res?.id || res?.correlationId || null };
        }, { id: `dry-writeoff-${dealId}` });
    }
}

export class RealOnecGateway implements OnecGateway {
    private refCache = new Map<string, string | null>();
    constructor(private cfg: HubConfig, private out: Outbound, private client: any = null) {}
    private api(): any {
        if (!this.client) this.client = require('../../connectors/1c/1c-client');
        return this.client;
    }
    async findCounterpartyRef(catalog: string, name: string): Promise<string | null> {
        if (this.cfg.mode !== 'live') return `dry-ref:${name}`;
        const key = `${catalog}:${name}`;
        if (!this.refCache.has(key)) this.refCache.set(key, await this.api().findCatalogRefByName(catalog, name));
        return this.refCache.get(key) || null;
    }
    async createDocument(dealId: number, documentName: string, body: Record<string, any>): Promise<{ ref: string | null; number: string | null }> {
        return this.out.write('1c', `create:${documentName}`, dealId, body, async () => {
            const res = await this.api().createDocument(documentName, body);
            return { ref: res?.Ref_Key || null, number: res?.Number || null };
        }, { ref: `dry-1c-${dealId}`, number: null });
    }
}

/** Алерты в Telegram. Без настроек молчит. Ошибка отправки не роняет обработку. */
export class TelegramAlerter implements Alerter {
    constructor(private cfg: HubConfig) {}
    async send(text: string): Promise<void> {
        const { tgToken, tgChatId } = this.cfg.alerts;
        if (!tgToken || !tgChatId) return;
        try {
            const axios = require('axios');
            await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`, { chat_id: tgChatId, text: text.slice(0, 3500) }, { timeout: 8000 });
        } catch (e: any) {
            logger.warn({ err: e?.message }, 'Алерт в Telegram не отправлен');
        }
    }
}

export function buildGateways(cfg: HubConfig, store: Store): Gateways {
    const out = new Outbound(store, cfg);
    return {
        amo: new RealAmoGateway(cfg, out),
        cdek: new RealCdekGateway(cfg, out),
        iiko: new RealIikoGateway(out),
        onec: new RealOnecGateway(cfg, out)
    };
}
