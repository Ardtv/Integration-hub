import { QueueRepository, QueueEvent } from '../repositories/queue.repository';
import { EventHandlerService } from '../services/event-handler.service';
import { logger } from '../config/logger';

const POLL_INTERVAL_MS = 5000;

export class QueueWorker {
    private running = false;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private queueRepo: QueueRepository,
        private eventHandler: EventHandlerService
    ) {}

    start(): void {
        if (this.running) return;
        this.running = true;
        logger.info('Queue worker started');
        this.scheduleNext();
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('Queue worker stopped');
    }

    private scheduleNext(): void {
        if (!this.running) return;
        this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
    }

    private async tick(): Promise<void> {
        try {
            const events = await this.queueRepo.getPending(5);
            if (events.length > 0) {
                logger.info({ count: events.length }, 'Found pending events');
            }
            for (const event of events) {
                if (!this.running) break;
                await this.processOne(event);
            }

            const retries = await this.queueRepo.getForRetry(5);
            if (retries.length > 0) {
                logger.info({ count: retries.length }, 'Found events to retry');
            }
            for (const event of retries) {
                if (!this.running) break;
                await this.processOne(event);
            }
        } catch (error: any) {
            logger.error({ err: error.message }, 'Worker tick error');
        } finally {
            this.scheduleNext();
        }
    }

    private async processOne(event: QueueEvent): Promise<void> {
        const retryCount = event.retry_count || 0;
        const maxRetries = event.max_retries || 3;

        logger.info({ eventId: event.id, eventType: event.event_type, retryCount, maxRetries }, 'Processing event');

        try {
            await this.queueRepo.markProcessing(event.id);
            await this.eventHandler.handle(event);
            await this.queueRepo.markProcessed(event.id);
            logger.info({ eventId: event.id }, 'Event processed successfully');
        } catch (error: any) {
            const message = error?.message || String(error);
            logger.error({ eventId: event.id, err: message }, 'Event failed');

            const nextRetry = retryCount + 1;
            if (nextRetry >= maxRetries) {
                logger.error({ eventId: event.id }, 'Event exceeded max retries, moving to dead');
                await this.queueRepo.markFailed(event.id, message);
                await this.queueRepo.markDead(event.id, message);
            } else {
                await this.queueRepo.markFailed(event.id, message);
                logger.warn({ eventId: event.id, nextRetry, maxRetries }, 'Event will be retried');
            }
        }
    }
}
