import { HubConfig } from '../config/config';
import { EVENTS, opKey, CdekStatusPayload } from '../contracts/events';
import { AmoDeal, Gateways } from '../gateways/types';
import { ProductMapRow, ShipmentRow, Store } from '../store/store';
import { buildCdekOrder, buildDestination } from './cdek-order';
import { ShipmentIntent, normalizePhone, readIntent } from './intent';

/** Ошибка, которую бессмысленно повторять: виноваты данные, а не сеть. */
export class PermanentError extends Error {}

/**
 * Жизненный цикл отправки сделки (ТЗ Этапа 2.1):
 *   new → validated → cdek_created → shipped → delivered | returned
 * плюс error (не прошла проверку), manual (Караганда, вручную), cancelled (отменена до отгрузки).
 */
export class Orchestrator {
    constructor(private store: Store, private gw: Gateways, private cfg: HubConfig) {}

    // ───────────────── сделка изменилась в amo ─────────────────

    async handleDealChanged(dealId: number): Promise<string> {
        const deal = await this.gw.amo.getDeal(dealId);
        if (!deal) return 'сделка не найдена в amo';

        const pipelines = this.cfg.amo.pipelineIds;
        if (pipelines.length && deal.pipeline_id && !pipelines.includes(deal.pipeline_id)) {
            return `воронка ${deal.pipeline_id} не обслуживается`;
        }

        await this.store.upsertDeal({
            id: deal.id, pipeline_id: deal.pipeline_id, status_id: deal.status_id, name: deal.name,
            price_minor: deal.price_minor, customer_name: deal.contact.name, customer_phone: deal.contact.phone,
            customer_email: deal.contact.email, responsible_user_id: deal.responsible_user_id,
            fields: deal.fields, amo_updated_at: deal.updated_at
        }, deal.items);

        const intent = readIntent(deal, this.cfg);
        const shipment = await this.store.getShipment(dealId);
        const onSendStage = !!this.cfg.amo.stages.send && deal.status_id === this.cfg.amo.stages.send;
        const state = shipment?.state || 'new';

        switch (state) {
            case 'new':
            case 'error':
            case 'manual':
            case 'validated':
            case 'cancelled':
                if (!onSendStage) return 'сделка не на этапе отправки';
                if (state === 'manual' && intent.method !== 'cdek') {
                    await this.store.saveShipment(dealId, this.intentColumns(intent));
                    return 'отправка вручную, без изменений';
                }
                return this.startShipment(deal, intent, shipment);

            case 'cdek_created':
                if (shipment!.address_hash !== intent.hash) return this.changeBeforeShipping(deal, intent, shipment!);
                return 'заявка уже создана, изменений нет';

            default: // shipped | delivered | returned
                if (shipment!.address_hash !== intent.hash) {
                    await this.store.saveShipment(dealId, { address_hash: intent.hash });
                    const text = 'Заказ уже отгружен: адрес в СДЭК не изменён. Если адрес действительно нужно поменять, обратитесь в СДЭК.';
                    await this.gw.amo.addNote(dealId, text);
                    await this.gw.amo.addTask(dealId, text, deal.responsible_user_id);
                    return 'адрес изменён после отгрузки, менеджер уведомлён';
                }
                return 'отправка в финальной стадии, изменений нет';
        }
    }

    private intentColumns(intent: ShipmentIntent): Partial<ShipmentRow> {
        return {
            method: intent.method, country: intent.country, delivery_type: intent.deliveryType,
            city: intent.city, address: intent.address, pvz_code: intent.pvzCode, address_hash: intent.hash
        };
    }

    /** Проверка сделки перед отправкой. Возвращает список понятных менеджеру ошибок. */
    validate(deal: AmoDeal, intent: ShipmentIntent, map: Map<number, ProductMapRow>): string[] {
        const e: string[] = [];
        if (!intent.method) e.push('Не выбран «Способ отправки» (СДЭК или Караганда)');
        if (intent.method !== 'cdek') return e;

        if (!intent.country) e.push('Не выбрана «Страна» (Казахстан или Россия)');
        if (!intent.deliveryType) e.push('Не выбран «Тип доставки» (до двери или ПВЗ)');
        if (intent.deliveryType === 'door') {
            if (!intent.city) e.push('Не заполнен «Город»');
            if (!intent.address) e.push('Не заполнен «Адрес» для доставки до двери');
        }
        if (intent.deliveryType === 'pvz' && !intent.pvzCode) e.push('Не заполнен «Код ПВЗ»');
        if (!deal.contact.name) e.push('У контакта нет имени');
        if (!normalizePhone(deal.contact.phone)) e.push('У контакта нет телефона или он слишком короткий');

        if (deal.items.length === 0) {
            e.push('В сделке нет товаров');
        } else {
            for (const it of deal.items) {
                if (!map.get(it.amo_product_id)?.iiko_product_id) {
                    e.push(`Товар «${it.name || it.amo_product_id}» не сопоставлен с IIKO`);
                }
                if (this.cfg.onec.enabled && !map.get(it.amo_product_id)?.onec_ref) {
                    e.push(`Товар «${it.name || it.amo_product_id}» не сопоставлен с карточкой 1С`);
                }
                if (it.price_minor <= 0) e.push(`У товара «${it.name || it.amo_product_id}» нет цены`);
                if (it.quantity <= 0) e.push(`У товара «${it.name || it.amo_product_id}» нулевое количество`);
            }
            const total = deal.items.reduce((s, it) => s + Math.round(it.price_minor * it.quantity), 0);
            if (this.cfg.amo.strictSum && deal.price_minor > 0 && total !== deal.price_minor) {
                e.push(`Бюджет сделки (${deal.price_minor / 100}) не равен сумме товаров (${total / 100}): наложенный платёж был бы неверным`);
            }
        }
        return e;
    }

    private async startShipment(deal: AmoDeal, intent: ShipmentIntent, existing: ShipmentRow | null): Promise<string> {
        const map = await this.store.getProductMap(deal.items.map(i => i.amo_product_id));
        const errors = this.validate(deal, intent, map);

        if (errors.length) {
            const text = `Заявка не создана:\n• ${errors.join('\n• ')}`;
            const sameError = existing?.state === 'error' && existing.error === text;
            await this.store.saveShipment(deal.id, { ...this.intentColumns(intent), state: 'error', error: text });
            if (!sameError) {
                await this.gw.amo.addNote(deal.id, text);
                await this.gw.amo.addTask(deal.id, 'Исправьте данные сделки и верните её на этап отправки', deal.responsible_user_id);
            }
            if (this.cfg.amo.stages.error) await this.gw.amo.setStage(deal.id, this.cfg.amo.stages.error, deal.pipeline_id);
            return `ошибка оформления: ${errors.length}`;
        }

        if (intent.method === 'karaganda') {
            await this.store.saveShipment(deal.id, { ...this.intentColumns(intent), state: 'manual', error: null });
            if (existing?.state !== 'manual') {
                await this.gw.amo.addNote(deal.id, 'Способ отправки «Караганда (B2B)»: заявка в СДЭК не создаётся, отправка оформляется вручную.');
            }
            return 'Караганда: вручную';
        }

        await this.store.saveShipment(deal.id, { ...this.intentColumns(intent), state: 'validated', error: null });

        // Если прошлый запуск упал после создания заказа в СДЭК, но до записи uuid,
        // заказ с номером сделки уже существует: берём его, а не создаём второй.
        const prior = await this.gw.cdek.findByImNumber(String(deal.id));
        const dead = ['INVALID', 'CANCELLED', 'REMOVED'];
        const found = prior && !prior.statuses.some(st => dead.includes(String(st.code).toUpperCase())) ? prior : null;
        let uuid: string;
        try {
            uuid = found?.uuid || (await this.gw.cdek.createOrder(deal.id, buildCdekOrder(deal, intent, map, this.cfg))).uuid;
        } catch (e: any) {
            const status = e?.response?.status;
            if (status >= 400 && status < 500 && status !== 429) {
                // СДЭК отклонил данные заказа: повтор не поможет, нужен менеджер.
                const reason = JSON.stringify(e.response?.data?.requests?.[0]?.errors || e.response?.data || e.message).slice(0, 600);
                return this.failShipment(deal, `СДЭК отклонил заявку: ${reason}`);
            }
            throw e;
        }

        await this.store.saveShipment(deal.id, { state: 'cdek_created', cdek_uuid: uuid, cdek_number: found?.cdek_number || null });
        await this.gw.amo.addNote(deal.id, `Заявка в СДЭК создана${found ? ' (найдена существующая)' : ''}. Трек-номер появится в поле «Трек СДЭК», когда СДЭК его присвоит.`);
        if (found?.cdek_number) await this.writeTrack(deal.id, found.cdek_number);
        if (this.cfg.amo.stages.created) await this.gw.amo.setStage(deal.id, this.cfg.amo.stages.created, deal.pipeline_id);
        return 'заявка СДЭК создана';
    }

    private async failShipment(deal: { id: number; responsible_user_id: number | null; pipeline_id: number | null }, text: string): Promise<string> {
        await this.store.saveShipment(deal.id, { state: 'error', error: text });
        await this.gw.amo.addNote(deal.id, text);
        await this.gw.amo.addTask(deal.id, 'Исправьте данные сделки и верните её на этап отправки', deal.responsible_user_id);
        if (this.cfg.amo.stages.error) await this.gw.amo.setStage(deal.id, this.cfg.amo.stages.error, deal.pipeline_id);
        return 'ошибка оформления';
    }

    private async changeBeforeShipping(deal: AmoDeal, intent: ShipmentIntent, shipment: ShipmentRow): Promise<string> {
        if (intent.method !== 'cdek') {
            await this.store.saveShipment(deal.id, { address_hash: intent.hash });
            const text = 'Способ отправки изменён, но заявка в СДЭК уже создана. Хаб её не отменяет: отмените заявку в кабинете СДЭК вручную.';
            await this.gw.amo.addNote(deal.id, text);
            await this.gw.amo.addTask(deal.id, text, deal.responsible_user_id);
            return 'способ отправки изменён после создания заявки';
        }
        const map = await this.store.getProductMap(deal.items.map(i => i.amo_product_id));
        const errors = this.validate(deal, intent, map).filter(x => /Город|Адрес|ПВЗ|Тип доставки|Страна/.test(x));
        if (errors.length) {
            await this.gw.amo.addNote(deal.id, `Адрес в заявке СДЭК не обновлён:\n• ${errors.join('\n• ')}`);
            return 'новый адрес не прошёл проверку';
        }
        await this.gw.cdek.updateOrder(deal.id, {
            uuid: shipment.cdek_uuid,
            tariff_code: intent.deliveryType === 'pvz' ? this.cfg.cdek.tariffPvz : this.cfg.cdek.tariffDoor,
            ...buildDestination(intent)
        });
        await this.store.saveShipment(deal.id, this.intentColumns(intent));
        await this.gw.amo.addNote(deal.id, 'Адрес доставки в заявке СДЭК обновлён. Новая заявка не создавалась.');
        return 'заявка СДЭК обновлена';
    }

    private async writeTrack(dealId: number, cdekNumber: string): Promise<void> {
        if (this.cfg.amo.fields.track) await this.gw.amo.setField(dealId, this.cfg.amo.fields.track, cdekNumber);
    }

    // ───────────────── статус из СДЭК ─────────────────

    classify(code: string): 'shipped' | 'delivered' | 'returned' | 'other' {
        const c = String(code).toUpperCase();
        if (this.cfg.cdek.deliveredCodes.includes(c)) return 'delivered';
        if (this.cfg.cdek.returnedCodes.includes(c)) return 'returned';
        if (this.cfg.cdek.shippedCodes.includes(c)) return 'shipped';
        return 'other';
    }

    async handleCdekStatus(p: CdekStatusPayload): Promise<string> {
        const sh = await this.store.getShipmentByCdekUuid(p.cdek_uuid);
        if (!sh) return `заказ СДЭК ${p.cdek_uuid} не принадлежит ни одной сделке`;
        const dealId = sh.deal_id;
        const deal = await this.store.getDeal(dealId);
        const code = String(p.code).toUpperCase();

        if (p.cdek_number && p.cdek_number !== sh.cdek_number) {
            await this.store.saveShipment(dealId, { cdek_number: p.cdek_number });
            await this.writeTrack(dealId, p.cdek_number);
        }
        const repeated = sh.cdek_status === code;
        await this.store.saveShipment(dealId, { cdek_status: code });

        // СДЭК проверяет заказ асинхронно: отказ приходит статусом INVALID уже после создания.
        if (code === 'INVALID' && sh.state === 'cdek_created') {
            await this.failShipment(
                { id: dealId, responsible_user_id: deal?.responsible_user_id ?? null, pipeline_id: deal?.pipeline_id ?? null },
                'СДЭК не принял заявку (статус INVALID). Причину смотрите в кабинете СДЭК, исправьте сделку и верните её на этап отправки.'
            );
            return 'СДЭК отклонил заявку';
        }

        const kind = this.classify(code);

        if (kind === 'shipped') {
            if (sh.state !== 'cdek_created') return 'отгрузка уже учтена';
            await this.store.saveShipment(dealId, { state: 'shipped' });
            await this.requestShippingDocs(dealId);
            await this.gw.amo.addNote(dealId, `СДЭК: заказ отгружен со склада (${code}). Запущены списание в IIKO и черновик реализации в 1С.`);
            return 'отгружено';
        }

        if (kind === 'delivered') {
            if (sh.state === 'delivered') return 'доставка уже учтена';
            if (sh.state !== 'cdek_created' && sh.state !== 'shipped') return `статус «доставлено» пропущен: отправка в состоянии ${sh.state}`;
            // Статус отгрузки мог не дойти: документы всё равно должны появиться ровно один раз.
            if (sh.state === 'cdek_created') await this.requestShippingDocs(dealId);
            await this.store.saveShipment(dealId, { state: 'delivered' });
            if (this.cfg.amo.stages.delivered) await this.gw.amo.setStage(dealId, this.cfg.amo.stages.delivered, deal?.pipeline_id);
            await this.gw.amo.addNote(dealId, 'СДЭК: заказ доставлен.');
            return 'доставлено';
        }

        if (kind === 'returned') {
            if (sh.state === 'returned' || sh.state === 'cancelled') return 'возврат уже учтён';
            if (sh.state === 'cdek_created') {
                // Товар со склада не уезжал: списания не было, возвращать нечего.
                await this.store.saveShipment(dealId, { state: 'cancelled' });
                await this.gw.amo.addNote(dealId, `СДЭК: заказ не доставлен до отгрузки со склада (${code}). Документы не создавались.`);
                return 'отменено до отгрузки';
            }
            await this.store.saveShipment(dealId, { state: 'returned' });
            await this.enqueueDoc(EVENTS.SHIPMENT_RETURN_IIKO, opKey.returnIiko(dealId), dealId);
            await this.enqueueDoc(EVENTS.SHIPMENT_RETURN_1C, opKey.return1c(dealId), dealId);
            if (this.cfg.amo.stages.returned) await this.gw.amo.setStage(dealId, this.cfg.amo.stages.returned, deal?.pipeline_id);
            await this.gw.amo.addNote(dealId, `СДЭК: отказ или возврат (${code}). Запущены возвратные документы.`);
            return 'возврат';
        }

        // Промежуточные статусы этап сделки не двигают, только попадают в примечание.
        if (!repeated) await this.gw.amo.addNote(dealId, `СДЭК: ${code}`);
        return 'промежуточный статус';
    }

    private async requestShippingDocs(dealId: number): Promise<void> {
        await this.enqueueDoc(EVENTS.SHIPMENT_WRITEOFF, opKey.writeoff(dealId), dealId);
        await this.enqueueDoc(EVENTS.SHIPMENT_SALE, opKey.sale(dealId), dealId);
    }

    /** Документ ставится в очередь отдельным событием: у него свои повторы и своя идемпотентность. */
    private async enqueueDoc(eventType: string, key: string, dealId: number): Promise<void> {
        await this.store.enqueue({ eventType, source: 'hub', payload: { deal_id: dealId }, operationKey: key, dealId, priority: 5 });
    }

    // ───────────────── событие не обработалось окончательно ─────────────────

    async notifyDead(dealId: number, eventType: string, error: string): Promise<void> {
        const text = `Интеграция не смогла выполнить операцию «${eventType}»: ${error}. Нужна ручная проверка, повтор доступен в панели контроля хаба.`;
        await this.gw.amo.addNote(dealId, text);
        const deal = await this.store.getDeal(dealId);
        await this.gw.amo.addTask(dealId, text, deal?.responsible_user_id);
    }
}
