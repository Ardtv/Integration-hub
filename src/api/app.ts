import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import { HubConfig } from '../config/config';
import { EVENTS, opKey, validateEvent } from '../contracts/events';
import { Store } from '../store/store';
import { logger } from '../config/logger';

function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const DOC_KINDS: Record<string, { event: string; key: (id: number) => string }> = {
    writeoff: { event: EVENTS.SHIPMENT_WRITEOFF, key: opKey.writeoff },
    sale: { event: EVENTS.SHIPMENT_SALE, key: opKey.sale },
    return_iiko: { event: EVENTS.SHIPMENT_RETURN_IIKO, key: opKey.returnIiko },
    return_1c: { event: EVENTS.SHIPMENT_RETURN_1C, key: opKey.return1c }
};

export function createApp(store: Store, cfg: HubConfig) {
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(express.json({ limit: '2mb' }));

    const auth = (req: Request, res: Response, next: NextFunction) => {
        // Токен принимается только из заголовка: из строки запроса он попал бы в логи.
        const token = String(req.headers['x-api-token'] || '');
        if (!cfg.apiToken || !token || !safeEqual(token, cfg.apiToken)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
    const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
        fn(req, res).catch(e => { logger.error({ err: e }, 'Ошибка API'); res.status(500).json({ error: 'Internal error' }); });

    app.get('/health', wrap(async (_req, res) => {
        try {
            await store.ping();
            res.json({ status: 'ok', service: 'integration-hub', mode: cfg.mode });
        } catch {
            res.status(503).json({ status: 'error', service: 'integration-hub' });
        }
    }));

    // Страница панели статична и секретов не содержит: данные она получает через API с токеном.
    app.get('/panel', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'panel.html')));

    // ───────── приём событий от коннекторов ─────────
    app.post('/api/events', auth, wrap(async (req, res) => {
        const { eventType, source, payload, operationKey, priority } = req.body || {};
        if (!eventType || !source || !operationKey) {
            return res.status(400).json({ error: 'Нужны eventType, source и operationKey' });
        }
        const problem = validateEvent(String(eventType), payload);
        if (problem) return res.status(400).json({ error: problem });
        const dealId = Number(payload?.deal_id) || null;
        const event = await store.enqueue({ eventType, source, payload, operationKey: String(operationKey), priority, dealId });
        if (!event) return res.status(200).json({ status: 'duplicate' });
        res.status(202).json({ status: 'accepted', eventId: event.id });
    }));

    // ───────── панель контроля ─────────
    const admin = express.Router();
    admin.use(auth);

    admin.get('/stats', wrap(async (_req, res) => res.json({ mode: cfg.mode, queue: await store.queueStats() })));

    admin.get('/events', wrap(async (req, res) => {
        res.json(await store.listEvents({
            status: req.query.status ? String(req.query.status) : undefined,
            source: req.query.source ? String(req.query.source) : undefined,
            dealId: req.query.deal_id ? Number(req.query.deal_id) : undefined,
            limit: Number(req.query.limit) || 50,
            offset: Number(req.query.offset) || 0
        }));
    }));

    admin.post('/events/:id/retry', wrap(async (req, res) => {
        const ok = await store.retryEvent(Number(req.params.id));
        res.status(ok ? 200 : 409).json(ok ? { status: 'queued' } : { error: 'Повторить можно только событие в статусе failed или dead' });
    }));

    admin.get('/shipments', wrap(async (req, res) => {
        res.json(await store.listShipments({ state: req.query.state ? String(req.query.state) : undefined, limit: Number(req.query.limit) || 50 }));
    }));

    admin.get('/deals/:id', wrap(async (req, res) => {
        const id = Number(req.params.id);
        const deal = await store.getDeal(id);
        if (!deal) return res.status(404).json({ error: 'Сделки нет в базе хаба' });
        res.json({
            deal,
            items: await store.getDealItems(id),
            shipment: await store.getShipment(id),
            documents: await store.listStockDocs(id),
            events: await store.listEvents({ dealId: id, limit: 50 }),
            outbound: await store.listOutbound({ dealId: id, limit: 50 })
        });
    }));

    // Перечитать сделку из amo и прогнать её через оркестратор заново.
    admin.post('/deals/:id/resync', wrap(async (req, res) => {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ error: 'Некорректный ID сделки' });
        const ev = await store.enqueue({
            eventType: EVENTS.AMO_DEAL_CHANGED, source: 'panel', payload: { deal_id: id, kind: 'manual' },
            operationKey: `panel:${id}:resync:${Date.now()}`, dealId: id
        });
        res.status(202).json({ status: 'queued', eventId: ev?.id });
    }));

    // Повторно создать документ, который был пропущен или упал.
    admin.post('/deals/:id/documents/:kind/rerun', wrap(async (req, res) => {
        const id = Number(req.params.id);
        const kind = DOC_KINDS[String(req.params.kind)];
        if (!id || !kind) return res.status(400).json({ error: 'Неизвестный документ' });
        const reset = await store.resetStockDoc(kind.key(id));
        if (!reset) return res.status(409).json({ error: 'Документ уже создан или ещё не запрашивался' });
        const ev = await store.enqueue({
            eventType: kind.event, source: 'panel', payload: { deal_id: id },
            operationKey: `${kind.key(id)}:rerun:${Date.now()}`, dealId: id, priority: 5
        });
        res.status(202).json({ status: 'queued', eventId: ev?.id });
    }));

    admin.get('/outbound', wrap(async (req, res) => {
        res.json(await store.listOutbound({
            dealId: req.query.deal_id ? Number(req.query.deal_id) : undefined,
            system: req.query.system ? String(req.query.system) : undefined,
            limit: Number(req.query.limit) || 50
        }));
    }));

    admin.get('/products', wrap(async (req, res) => res.json(await store.listProductMap(req.query.unmapped === '1'))));

    admin.put('/products/:amoProductId', wrap(async (req, res) => {
        const id = Number(req.params.amoProductId);
        if (!id) return res.status(400).json({ error: 'Некорректный ID товара' });
        await store.setProductMap(id, req.body || {});
        res.json({ status: 'saved' });
    }));

    app.use('/api/admin', admin);
    return app;
}
