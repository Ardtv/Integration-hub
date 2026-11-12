import dotenv from 'dotenv';
dotenv.config();

import { loadConfig, startupProblems } from './config/config';
import { pool, testConnection } from './config/database';
import { logger } from './config/logger';
import { createApp } from './api/app';
import { EventHandler } from './core/event-handler';
import { QueueWorker } from './core/worker';
import { buildGateways, TelegramAlerter } from './gateways/real';
import { Documents } from './services/documents';
import { Orchestrator } from './services/orchestrator';
import { Store } from './store/store';

async function start() {
    const cfg = loadConfig();
    const problems = startupProblems(cfg);
    for (const p of problems) logger[cfg.production ? 'error' : 'warn'](p);
    if (problems.length && cfg.production) {
        logger.error('Запуск остановлен: исправьте настройки в .env');
        process.exit(1);
    }

    if (!(await testConnection())) process.exit(1);

    const store = new Store(pool);
    const gateways = buildGateways(cfg, store);
    const orchestrator = new Orchestrator(store, gateways, cfg);
    const documents = new Documents(store, gateways, cfg);
    const alerter = new TelegramAlerter(cfg);
    const worker = new QueueWorker(store, new EventHandler(store, orchestrator, documents), orchestrator, alerter);

    const app = createApp(store, cfg);
    // Хаб слушает только локальный интерфейс: наружу его публикует nginx.
    const server = app.listen(cfg.port, process.env.HUB_BIND || '127.0.0.1', () => {
        logger.info({ port: cfg.port, mode: cfg.mode }, cfg.mode === 'live'
            ? 'Integration Hub запущен в БОЕВОМ режиме'
            : 'Integration Hub запущен в тестовом режиме: во внешние системы ничего не записывается');
    });
    worker.start();

    const shutdown = async () => {
        worker.stop();
        server.close();
        await pool.end();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

start().catch(e => { logger.error({ err: e }, 'Хаб не запустился'); process.exit(1); });
