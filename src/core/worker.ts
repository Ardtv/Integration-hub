import { logger } from '../config/logger';
import { Alerter } from '../gateways/types';
import { Orchestrator, PermanentError } from '../services/orchestrator';
import { QueueEvent, Store } from '../store/store';
import { EventHandler } from './event-handler';

export class QueueWorker {
    private running = false;
    private timer: NodeJS.Timeout | null = null;
    private ticks = 0;

    constructor(private store: Store, private handler: EventHandler, private orchestrator: Orchestrator,
                private alerter: Alerter, private pollMs = 1000, private batch = 10) {}

    start(): void {
        if (this.running) return;
        this.running = true;
        const loop = async () => {
            if (!this.running) return;
            try { await this.tick(); } catch (e) { logger.error({ err: e }, 'Ошибка цикла очереди'); }
            this.timer = setTimeout(loop, this.pollMs);
        };
        void loop();
        logger.info('Воркер очереди запущен');
    }

    stop(): void {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
    }

    /** Один проход: вернуть зависшие, забрать пачку, обработать. Возвращает число обработанных. */
    async tick(): Promise<number> {
        if (this.ticks++ % 60 === 0) {
            const released = await this.store.releaseStuck();
            if (released) logger.warn({ released }, 'Зависшие события возвращены в очередь');
        }
        const events = await this.store.claim(this.batch);
        for (const event of events) await this.process(event);
        return events.length;
    }

    /** Обрабатывает очередь, пока в ней есть готовые события. Для тестов и скриптов. */
    async drain(max = 200): Promise<number> {
        let total = 0;
        for (;;) {
            const n = await this.tick();
            total += n;
            if (n === 0 || total >= max) return total;
        }
    }

    private async process(event: QueueEvent): Promise<void> {
        const dealId = event.deal_id ?? (Number(event.payload?.deal_id) || null);
        try {
            const result = await this.handler.handle(event);
            await this.store.markProcessed(event.id);
            await this.store.log('info', result, { queueId: event.id, dealId, metadata: { event_type: event.event_type } });
        } catch (e: any) {
            const message = String(e?.message || e);
            let status = await this.store.markFailed(event.id, message);
            // Ошибку в данных повторять бессмысленно: сразу в dead letter.
            if (e instanceof PermanentError && status !== 'dead') {
                while (status !== 'dead') status = await this.store.markFailed(event.id, message);
            }
            await this.store.log('error', message, { queueId: event.id, dealId, metadata: { event_type: event.event_type, status } });
            logger.error({ id: event.id, type: event.event_type, status, err: message }, 'Событие не обработано');
            if (status === 'dead') {
                await this.alerter.send(`Integration Hub: событие #${event.id} (${event.event_type}) не обработано.\nСделка: ${dealId ?? '—'}\n${message}`);
                if (dealId) {
                    try { await this.orchestrator.notifyDead(dealId, event.event_type, message); }
                    catch (err) { logger.error({ err }, 'Не удалось уведомить менеджера в amo'); }
                }
            }
        }
    }
}
