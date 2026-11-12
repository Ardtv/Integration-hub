import { HubConfig } from '../config/config';
import { opKey } from '../contracts/events';
import { Gateways } from '../gateways/types';
import { DealItemRow, DealRow, ProductMapRow, ShipmentRow, Store } from '../store/store';
import { PermanentError } from './orchestrator';

interface Ctx { deal: DealRow; items: DealItemRow[]; map: Map<number, ProductMapRow>; shipment: ShipmentRow }

/**
 * Складские и бухгалтерские документы по отправке.
 * Каждый документ имеет ключ deal:{id}:… и создаётся не более одного раза.
 */
export class Documents {
    constructor(private store: Store, private gw: Gateways, private cfg: HubConfig) {}

    private async context(dealId: number): Promise<Ctx> {
        const deal = await this.store.getDeal(dealId);
        const shipment = await this.store.getShipment(dealId);
        if (!deal || !shipment) throw new PermanentError(`Сделка ${dealId} или её отправка не найдены в базе хаба`);
        const items = await this.store.getDealItems(dealId);
        if (items.length === 0) throw new PermanentError(`В сделке ${dealId} нет товаров`);
        const map = await this.store.getProductMap(items.map(i => i.amo_product_id));
        return { deal, items, map, shipment };
    }

    /** Общая обвязка: идемпотентность, запись результата, примечание в сделку. */
    private async once(dealId: number, kind: string, key: string, system: string, title: string,
                       run: (ctx: Ctx) => Promise<{ status: 'done' | 'skipped'; externalId?: string | null; detail?: string | null }>): Promise<string> {
        const doc = await this.store.ensureStockDoc({ dealId, kind, opKey: key, system });
        if (doc.status === 'done' || doc.status === 'skipped') return `${title}: уже обработано (${doc.status})`;
        try {
            const res = await run(await this.context(dealId));
            await this.store.finishStockDoc(key, res.status, res.externalId ?? null, res.detail ?? null);
            const mode = this.cfg.mode === 'live' ? '' : ' [тестовый режим: в систему ничего не отправлено]';
            await this.gw.amo.addNote(dealId, res.status === 'done'
                ? `${title}: создано${res.externalId ? ` (${res.externalId})` : ''}.${mode}`
                : `${title}: не создано автоматически. ${res.detail || ''}`);
            if (res.status === 'skipped') {
                const deal = await this.store.getDeal(dealId);
                await this.gw.amo.addTask(dealId, `${title}: оформите вручную. ${res.detail || ''}`, deal?.responsible_user_id);
            }
            return `${title}: ${res.status}`;
        } catch (e: any) {
            await this.store.finishStockDoc(key, 'failed', null, String(e?.message || e).slice(0, 1000));
            throw e;
        }
    }

    // ───────── IIKO: списание по отгрузке ─────────

    async writeoff(dealId: number): Promise<string> {
        return this.once(dealId, 'writeoff', opKey.writeoff(dealId), 'iiko', 'Списание в IIKO', async ({ deal, items, map, shipment }) => {
            const c = this.cfg.iiko;
            if (!c.writeoffEnabled) return { status: 'skipped', detail: 'Списание в IIKO выключено (IIKO_WRITEOFF_ENABLED). Спишите товар вручную.' };
            if (!c.organizationId || !c.storeId || !c.expenseAccountId) {
                throw new PermanentError('Для списания нужны IIKO_ORGANIZATION_ID, IIKO_STORE_ID и IIKO_EXPENSE_ACCOUNT_ID');
            }
            const lines = items.map((it, i) => {
                const m = map.get(it.amo_product_id);
                if (!m?.iiko_product_id) throw new PermanentError(`Товар «${it.name || it.amo_product_id}» не сопоставлен с IIKO`);
                const unit = m.iiko_unit_id || c.defaultUnitId;
                if (!unit) throw new PermanentError(`Для товара «${it.name || it.amo_product_id}» не задана единица измерения IIKO`);
                return { num: i + 1, product: m.iiko_product_id, amount: it.quantity, amountUnit: unit };
            });
            // Формат взят из рабочего тестового запроса Этапа 2 (writeoff_document/create).
            const res = await this.gw.iiko.createWriteoff(dealId, {
                organizationId: c.organizationId,
                date: new Date().toISOString(),
                storeFrom: c.storeId,
                expenseAccount: c.expenseAccountId,
                isAutomatic: false,
                isEditable: true,
                comment: `amoCRM сделка ${deal.id}, СДЭК ${shipment.cdek_number || shipment.cdek_uuid || ''}`.trim(),
                items: lines
            });
            return { status: 'done', externalId: res.id };
        });
    }

    // ───────── IIKO: возврат ─────────

    async returnIiko(dealId: number): Promise<string> {
        return this.once(dealId, 'return_iiko', opKey.returnIiko(dealId), 'iiko', 'Возврат в IIKO', async () => {
            // Допущение: документ, которым IIKO принимает товар обратно, с менеджером IIKO не согласован.
            // Запрос не выдумываем: менеджер получает задачу оприходовать возврат вручную.
            return { status: 'skipped', detail: 'Формат документа возврата в IIKO не согласован. Оприходуйте возврат вручную.' };
        });
    }

    // ───────── 1С: черновики реализации и возврата ─────────

    private async onecBody({ deal, items, map, shipment }: Ctx, kind: string): Promise<Record<string, any>> {
        const c = this.cfg.onec;
        const country = (shipment.country === 'RU' ? 'RU' : 'KZ') as 'KZ' | 'RU';
        const ref = c.counterpartyRef[country] || await this.gw.onec.findCounterpartyRef(c.counterpartyCatalog, c.counterparty[country]);
        if (!ref) throw new PermanentError(`В 1С не найден контрагент «${c.counterparty[country]}»`);
        const lines = items.map((it, i) => {
            const m = map.get(it.amo_product_id);
            if (!m?.onec_ref) throw new PermanentError(`Товар «${it.name || it.amo_product_id}» не сопоставлен с карточкой 1С`);
            const price = it.price_minor / 100;
            return { LineNumber: String(i + 1), 'Номенклатура_Key': m.onec_ref, 'Количество': it.quantity, 'Цена': price, 'Сумма': Math.round(price * it.quantity * 100) / 100 };
        });
        return {
            Date: new Date().toISOString().slice(0, 19),
            Posted: false, // черновик: бухгалтер проверяет и проводит сам
            'Контрагент_Key': ref,
            'Комментарий': `${kind}: amoCRM сделка ${deal.id}, СДЭК ${shipment.cdek_number || ''}`.trim(),
            [c.itemsTable]: lines,
            ...c.extra
        };
    }

    async sale(dealId: number): Promise<string> {
        return this.once(dealId, 'sale', opKey.sale(dealId), '1c', 'Черновик реализации в 1С', async ctx => {
            const c = this.cfg.onec;
            if (!c.enabled) return { status: 'skipped', detail: 'Выгрузка в 1С выключена (API_1C_ENABLED). Создайте реализацию вручную.' };
            const res = await this.gw.onec.createDocument(dealId, c.saleDocument, await this.onecBody(ctx, 'Реализация'));
            return { status: 'done', externalId: res.number || res.ref };
        });
    }

    async return1c(dealId: number): Promise<string> {
        return this.once(dealId, 'return_1c', opKey.return1c(dealId), '1c', 'Черновик возврата в 1С', async ctx => {
            const c = this.cfg.onec;
            if (!c.enabled) return { status: 'skipped', detail: 'Выгрузка в 1С выключена (API_1C_ENABLED). Создайте возврат вручную.' };
            const res = await this.gw.onec.createDocument(dealId, c.returnDocument, await this.onecBody(ctx, 'Возврат'));
            return { status: 'done', externalId: res.number || res.ref };
        });
    }
}
