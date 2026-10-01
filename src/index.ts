import express from 'express';
import dotenv from 'dotenv';
import { pool, testConnection } from './config/database';
import { OrderRepository } from './repositories/order.repository';
import { QueueRepository } from './repositories/queue.repository';
import { MappingRepository } from './repositories/mapping.repository';
import { OrderService } from './services/order.service';
import { EventHandlerService } from './services/event-handler.service';
import { QueueWorker } from './queue/worker';
import { setupRoutes } from './api/events.controller';
import { logger } from './config/logger';
import { OrderItemRepository } from './repositories/order-item.repository';
import { IikoService } from './services/iiko.service';

dotenv.config();

const app = express();
const PORT = process.env.HUB_PORT || 3001;

app.use(express.json());

const orderRepo = new OrderRepository(pool);
const queueRepo = new QueueRepository(pool);
const mappingRepo = new MappingRepository(pool);
const orderItemRepo = new OrderItemRepository(pool);

const orderService = new OrderService(orderRepo, mappingRepo, orderItemRepo, pool);
const eventHandler = new EventHandlerService(orderService, queueRepo);

const iikoService = new IikoService(
  process.env.IIKO_API_KEY!,
  process.env.IIKO_APP_ID!,
  process.env.IIKO_CLIENT_SECRET!
);


app.use('/api', setupRoutes(queueRepo));

app.get('/health', async (req, res) => {
    const startTime = Date.now();

    let dbOk = false;
    try {
        await pool.query('SELECT 1');
        dbOk = true;
    } catch (e) {
        dbOk = false;
    }

    let queueStats: any = null;
    try {
        queueStats = await queueRepo.getStats();
    } catch (e) {
        queueStats = null;
    }

    const responseTime = Date.now() - startTime;

    res.status(dbOk ? 200 : 503).json({
        status: dbOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        response_time_ms: responseTime,
        checks: {
            database: dbOk ? 'ok' : 'down',
            queue: queueStats ? 'ok' : 'down'
        },
        queue: queueStats
    });
});

async function start() {
    const dbOk = await testConnection();
    if (!dbOk) {
        process.exit(1);
    }

    app.listen(PORT, () => {
        logger.info({ port: PORT }, 'Hub running');
    });

    const worker = new QueueWorker(queueRepo, eventHandler);
    worker.start();

    process.on('SIGTERM', () => {
        logger.info('Shutting down');
        worker.stop();
        pool.end();
        process.exit(0);
    });
}

start();
