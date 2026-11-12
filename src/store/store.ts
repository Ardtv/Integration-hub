import { Pool } from 'pg';

export type ShipmentState =
    | 'new' | 'error' | 'manual' | 'validated' | 'cdek_created'
    | 'shipped' | 'delivered' | 'returned' | 'cancelled';

export interface QueueEvent {
    id: number;
    event_type: string;
    source: string;
    payload: any;
    status: 'pending' | 'processing' | 'processed' | 'failed' | 'dead';
    priority: number;
    operation_key: string;
    retry_count: number;
    max_retries: number;
    error_message: string | null;
    deal_id: number | null;
    created_at: Date;
    processed_at: Date | null;
}

export interface DealRow {
    id: number;
    pipeline_id: number | null;
    status_id: number | null;
    name: string | null;
    price_minor: number;
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    responsible_user_id: number | null;
}

export interface DealItemRow {
    amo_product_id: number;
    name: string | null;
    sku: string | null;
    quantity: number;
    price_minor: number;
}

export interface ShipmentRow {
    deal_id: number;
    method: string | null;
    country: string | null;
    delivery_type: string | null;
    city: string | null;
    address: string | null;
    pvz_code: string | null;
    address_hash: string | null;
    state: ShipmentState;
    cdek_uuid: string | null;
    cdek_number: string | null;
    cdek_status: string | null;
    error: string | null;
}

export interface ProductMapRow {
    amo_product_id: number;
    amo_name: string | null;
    iiko_product_id: string | null;
    iiko_unit_id: string | null;
    cdek_sku: string | null;
    weight_g: number | null;
    onec_ref: string | null;
}

export interface StockDocRow {
    id: number;
    deal_id: number;
    kind: string;
    op_key: string;
    system: string;
    status: 'pending' | 'done' | 'skipped' | 'failed';
    external_id: string | null;
    detail: string | null;
}

const int = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

function mapDeal(r: any): DealRow {
    return { ...r, id: Number(r.id), pipeline_id: int(r.pipeline_id), status_id: int(r.status_id), price_minor: Number(r.price_minor), responsible_user_id: int(r.responsible_user_id) };
}
function mapShipment(r: any): ShipmentRow {
    return { ...r, deal_id: Number(r.deal_id) };
}
function mapEvent(r: any): QueueEvent {
    return { ...r, id: Number(r.id), deal_id: int(r.deal_id) };
}

export class Store {
    constructor(private pool: Pool) {}

    // ───────── очередь ─────────

    /** Добавляет событие. Возвращает null, если такой operation_key уже был (дубль). */
    async enqueue(e: { eventType: string; source: string; payload: any; operationKey: string; priority?: number; dealId?: number | null; maxRetries?: number }): Promise<QueueEvent | null> {
        const r = await this.pool.query(
            `INSERT INTO integration_queue (event_type, source, payload, operation_key, priority, deal_id, max_retries)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 5))
             ON CONFLICT (operation_key) DO NOTHING
             RETURNING *`,
            [e.eventType, e.source, JSON.stringify(e.payload), e.operationKey, e.priority || 0, e.dealId ?? null, e.maxRetries ?? null]
        );
        return r.rows[0] ? mapEvent(r.rows[0]) : null;
    }

    /** Атомарно забирает события в работу: два воркера не возьмут одно и то же. */
    async claim(limit: number): Promise<QueueEvent[]> {
        const r = await this.pool.query(
            `UPDATE integration_queue q
                SET status = 'processing', locked_at = now(), updated_at = now()
              WHERE q.id IN (
                    SELECT id FROM integration_queue
                     WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
                     ORDER BY priority DESC, id
                     LIMIT $1
                     FOR UPDATE SKIP LOCKED)
            RETURNING q.*`,
            [limit]
        );
        return r.rows.map(mapEvent).sort((a, b) => b.priority - a.priority || a.id - b.id);
    }

    async markProcessed(id: number): Promise<void> {
        await this.pool.query(
            `UPDATE integration_queue SET status = 'processed', processed_at = now(), updated_at = now(), locked_at = NULL, error_message = NULL WHERE id = $1`,
            [id]
        );
    }

    /** Ошибка обработки: повтор с нарастающей задержкой либо dead letter. Возвращает итоговый статус. */
    async markFailed(id: number, error: string): Promise<'failed' | 'dead'> {
        const r = await this.pool.query(
            `UPDATE integration_queue
                SET retry_count = retry_count + 1,
                    error_message = $2,
                    locked_at = NULL,
                    updated_at = now(),
                    status = CASE WHEN retry_count + 1 >= max_retries THEN 'dead' ELSE 'failed' END,
                    processed_at = CASE WHEN retry_count + 1 >= max_retries THEN now() ELSE processed_at END,
                    next_attempt_at = now() + (power(2, retry_count) * interval '1 minute')
              WHERE id = $1
            RETURNING status`,
            [id, error.slice(0, 2000)]
        );
        return r.rows[0]?.status || 'failed';
    }

    /** События, зависшие в processing после падения процесса, возвращаются в очередь. */
    async releaseStuck(minutes = 10): Promise<number> {
        const r = await this.pool.query(
            `UPDATE integration_queue
                SET status = 'failed', locked_at = NULL, next_attempt_at = now(), updated_at = now(),
                    error_message = COALESCE(error_message, 'Обработка прервана, событие возвращено в очередь')
              WHERE status = 'processing' AND locked_at < now() - ($1 || ' minutes')::interval`,
            [String(minutes)]
        );
        return r.rowCount || 0;
    }

    /** Ручной повтор из панели контроля. */
    async retryEvent(id: number): Promise<boolean> {
        const r = await this.pool.query(
            `UPDATE integration_queue
                SET status = 'pending', retry_count = 0, next_attempt_at = now(), locked_at = NULL, updated_at = now()
              WHERE id = $1 AND status IN ('failed', 'dead')`,
            [id]
        );
        return (r.rowCount || 0) > 0;
    }

    async listEvents(f: { status?: string; source?: string; dealId?: number; limit?: number; offset?: number }): Promise<QueueEvent[]> {
        const where: string[] = [];
        const args: any[] = [];
        if (f.status) { args.push(f.status); where.push(`status = $${args.length}`); }
        if (f.source) { args.push(f.source); where.push(`source = $${args.length}`); }
        if (f.dealId) { args.push(f.dealId); where.push(`deal_id = $${args.length}`); }
        args.push(Math.min(f.limit || 50, 200));
        args.push(f.offset || 0);
        const r = await this.pool.query(
            `SELECT * FROM integration_queue ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
              ORDER BY id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
            args
        );
        return r.rows.map(mapEvent);
    }

    async queueStats(): Promise<Record<string, number>> {
        const r = await this.pool.query(`SELECT status, COUNT(*)::int AS cnt FROM integration_queue GROUP BY status`);
        const out: Record<string, number> = { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 };
        for (const row of r.rows) out[row.status] = row.cnt;
        return out;
    }

    async log(level: string, message: string, extra: { queueId?: number; dealId?: number | null; metadata?: any } = {}): Promise<void> {
        await this.pool.query(
            `INSERT INTO integration_logs (queue_id, deal_id, level, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
            [extra.queueId ?? null, extra.dealId ?? null, level, message, JSON.stringify(extra.metadata || {})]
        );
    }

    // ───────── исходящие вызовы ─────────

    async recordOutbound(o: { system: string; action: string; dealId?: number | null; mode: string; status: string; request?: any; response?: any; error?: string | null }): Promise<void> {
        await this.pool.query(
            `INSERT INTO outbound_calls (system, action, deal_id, mode, status, request, response, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [o.system, o.action, o.dealId ?? null, o.mode, o.status, JSON.stringify(o.request ?? null), JSON.stringify(o.response ?? null), o.error ?? null]
        );
    }

    async listOutbound(f: { dealId?: number; system?: string; limit?: number }): Promise<any[]> {
        const where: string[] = [];
        const args: any[] = [];
        if (f.dealId) { args.push(f.dealId); where.push(`deal_id = $${args.length}`); }
        if (f.system) { args.push(f.system); where.push(`system = $${args.length}`); }
        args.push(Math.min(f.limit || 50, 200));
        const r = await this.pool.query(
            `SELECT * FROM outbound_calls ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${args.length}`,
            args
        );
        return r.rows;
    }

    // ───────── сделки ─────────

    async upsertDeal(d: DealRow & { fields: Record<string, any>; amo_updated_at?: number | null }, items: DealItemRow[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO deals (id, pipeline_id, status_id, name, price_minor, customer_name, customer_phone, customer_email, responsible_user_id, fields, amo_updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 ON CONFLICT (id) DO UPDATE SET
                    pipeline_id = EXCLUDED.pipeline_id, status_id = EXCLUDED.status_id, name = EXCLUDED.name,
                    price_minor = EXCLUDED.price_minor, customer_name = EXCLUDED.customer_name,
                    customer_phone = EXCLUDED.customer_phone, customer_email = EXCLUDED.customer_email,
                    responsible_user_id = EXCLUDED.responsible_user_id, fields = EXCLUDED.fields,
                    amo_updated_at = EXCLUDED.amo_updated_at, updated_at = now()`,
                [d.id, d.pipeline_id, d.status_id, d.name, d.price_minor, d.customer_name, d.customer_phone, d.customer_email, d.responsible_user_id, JSON.stringify(d.fields || {}), d.amo_updated_at ?? null]
            );
            await client.query('DELETE FROM deal_items WHERE deal_id = $1', [d.id]);
            for (const it of items) {
                await client.query(
                    `INSERT INTO deal_items (deal_id, amo_product_id, name, sku, quantity, price_minor) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [d.id, it.amo_product_id, it.name, it.sku, it.quantity, it.price_minor]
                );
                // Новый товар сразу попадает в справочник как несопоставленный.
                await client.query(
                    `INSERT INTO product_map (amo_product_id, amo_name) VALUES ($1, $2)
                     ON CONFLICT (amo_product_id) DO UPDATE SET amo_name = COALESCE(EXCLUDED.amo_name, product_map.amo_name)`,
                    [it.amo_product_id, it.name]
                );
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async getDeal(id: number): Promise<DealRow | null> {
        const r = await this.pool.query('SELECT * FROM deals WHERE id = $1', [id]);
        return r.rows[0] ? mapDeal(r.rows[0]) : null;
    }

    async getDealItems(dealId: number): Promise<DealItemRow[]> {
        const r = await this.pool.query('SELECT amo_product_id, name, sku, quantity, price_minor FROM deal_items WHERE deal_id = $1 ORDER BY id', [dealId]);
        return r.rows.map(x => ({ amo_product_id: Number(x.amo_product_id), name: x.name, sku: x.sku, quantity: Number(x.quantity), price_minor: Number(x.price_minor) }));
    }

    // ───────── отправки ─────────

    async getShipment(dealId: number): Promise<ShipmentRow | null> {
        const r = await this.pool.query('SELECT * FROM shipments WHERE deal_id = $1', [dealId]);
        return r.rows[0] ? mapShipment(r.rows[0]) : null;
    }

    async getShipmentByCdekUuid(uuid: string): Promise<ShipmentRow | null> {
        const r = await this.pool.query('SELECT * FROM shipments WHERE cdek_uuid = $1', [uuid]);
        return r.rows[0] ? mapShipment(r.rows[0]) : null;
    }

    /** Создаёт или обновляет отправку сделки. Передаются только изменяемые поля. */
    async saveShipment(dealId: number, patch: Partial<Omit<ShipmentRow, 'deal_id'>>): Promise<ShipmentRow> {
        const cols = Object.keys(patch) as (keyof typeof patch)[];
        const vals = cols.map(c => (patch as any)[c]);
        const insertCols = ['deal_id', ...cols].join(', ');
        const insertVals = ['$1', ...cols.map((_, i) => `$${i + 2}`)].join(', ');
        const updates = [...cols.map(c => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ');
        const r = await this.pool.query(
            `INSERT INTO shipments (${insertCols}) VALUES (${insertVals})
             ON CONFLICT (deal_id) DO UPDATE SET ${updates}
             RETURNING *`,
            [dealId, ...vals]
        );
        return mapShipment(r.rows[0]);
    }

    async listShipments(f: { state?: string; limit?: number }): Promise<any[]> {
        const args: any[] = [];
        let where = '';
        if (f.state) { args.push(f.state); where = 'WHERE s.state = $1'; }
        args.push(Math.min(f.limit || 50, 200));
        const r = await this.pool.query(
            `SELECT s.*, d.name AS deal_name, d.customer_name, d.price_minor
               FROM shipments s JOIN deals d ON d.id = s.deal_id ${where}
              ORDER BY s.updated_at DESC LIMIT $${args.length}`,
            args
        );
        return r.rows;
    }

    /** Отправки, по которым стоит опросить СДЭК (запасной путь, если вебхук не пришёл). */
    async shipmentsToPoll(limit = 50): Promise<ShipmentRow[]> {
        const r = await this.pool.query(
            `SELECT * FROM shipments WHERE cdek_uuid IS NOT NULL AND state IN ('cdek_created', 'shipped') ORDER BY updated_at LIMIT $1`,
            [limit]
        );
        return r.rows.map(mapShipment);
    }

    // ───────── товары ─────────

    async getProductMap(ids: number[]): Promise<Map<number, ProductMapRow>> {
        const out = new Map<number, ProductMapRow>();
        if (ids.length === 0) return out;
        const r = await this.pool.query('SELECT * FROM product_map WHERE amo_product_id = ANY($1::bigint[])', [ids]);
        for (const row of r.rows) out.set(Number(row.amo_product_id), { ...row, amo_product_id: Number(row.amo_product_id) });
        return out;
    }

    async listProductMap(onlyUnmapped = false): Promise<ProductMapRow[]> {
        const r = await this.pool.query(
            `SELECT * FROM product_map ${onlyUnmapped ? 'WHERE iiko_product_id IS NULL' : ''} ORDER BY amo_name NULLS LAST, amo_product_id`
        );
        return r.rows.map(x => ({ ...x, amo_product_id: Number(x.amo_product_id) }));
    }

    async setProductMap(amoProductId: number, patch: Partial<Omit<ProductMapRow, 'amo_product_id'>>): Promise<void> {
        const allowed = ['amo_name', 'iiko_product_id', 'iiko_unit_id', 'cdek_sku', 'weight_g', 'onec_ref'];
        const cols = Object.keys(patch).filter(c => allowed.includes(c));
        if (cols.length === 0) return;
        const vals = cols.map(c => (patch as any)[c] === '' ? null : (patch as any)[c]);
        await this.pool.query(
            `INSERT INTO product_map (amo_product_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
             ON CONFLICT (amo_product_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
            [amoProductId, ...vals]
        );
    }

    async upsertFfOffer(o: { external_id: string; name?: string | null; sku?: string | null; article?: string | null; stock?: number; price_minor?: number; currency?: string }): Promise<void> {
        await this.pool.query(
            `INSERT INTO ff_offers (external_id, name, sku, article, stock, price_minor, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, sku = EXCLUDED.sku, article = EXCLUDED.article,
                stock = EXCLUDED.stock, price_minor = EXCLUDED.price_minor, currency = EXCLUDED.currency, updated_at = now()`,
            [o.external_id, o.name ?? null, o.sku ?? null, o.article ?? null, o.stock ?? null, o.price_minor ?? null, o.currency ?? null]
        );
    }

    // ───────── складские документы ─────────

    async getStockDoc(opKey: string): Promise<StockDocRow | null> {
        const r = await this.pool.query('SELECT * FROM stock_documents WHERE op_key = $1', [opKey]);
        return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id), deal_id: Number(r.rows[0].deal_id) } : null;
    }

    /** Создаёт запись документа, если её ещё нет. Повтор не создаёт вторую. */
    async ensureStockDoc(d: { dealId: number; kind: string; opKey: string; system: string }): Promise<StockDocRow> {
        await this.pool.query(
            `INSERT INTO stock_documents (deal_id, kind, op_key, system) VALUES ($1,$2,$3,$4) ON CONFLICT (op_key) DO NOTHING`,
            [d.dealId, d.kind, d.opKey, d.system]
        );
        return (await this.getStockDoc(d.opKey))!;
    }

    async finishStockDoc(opKey: string, status: 'done' | 'skipped' | 'failed', externalId: string | null, detail: string | null): Promise<void> {
        await this.pool.query(
            `UPDATE stock_documents SET status = $2, external_id = COALESCE($3, external_id), detail = $4, updated_at = now() WHERE op_key = $1`,
            [opKey, status, externalId, detail]
        );
    }

    /** Возвращает документ в ожидание, чтобы его можно было создать повторно из панели. */
    async resetStockDoc(opKey: string): Promise<boolean> {
        const r = await this.pool.query(
            `UPDATE stock_documents SET status = 'pending', detail = NULL, updated_at = now() WHERE op_key = $1 AND status IN ('skipped', 'failed')`,
            [opKey]
        );
        return (r.rowCount || 0) > 0;
    }

    async listStockDocs(dealId: number): Promise<StockDocRow[]> {
        const r = await this.pool.query('SELECT * FROM stock_documents WHERE deal_id = $1 ORDER BY id', [dealId]);
        return r.rows;
    }

    async ping(): Promise<boolean> {
        await this.pool.query('SELECT 1');
        return true;
    }
}
