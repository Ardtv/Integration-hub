import express from 'express';
import { QueueRepository } from '../repositories/queue.repository';
import { logger } from '../config/logger';

const router = express.Router();

const API_TOKEN = process.env.HUB_API_TOKEN;

export function setupRoutes(queueRepo: QueueRepository) {
    router.use((req, res, next) => {
        if (!API_TOKEN) {
            logger.warn('HUB_API_TOKEN not set — skipping auth check');
            return next();
        }
        const token = req.headers['x-api-token'];
        if (token !== API_TOKEN) {
            logger.warn({ ip: req.ip }, 'Unauthorized request');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    router.post('/events', async (req, res) => {
        try {
            const event = req.body;

            if (!event.eventType || !event.source || !event.payload) {
                return res.status(400).json({
                    error: 'Missing required fields: eventType, source, payload'
                });
            }

            const operationKey = event.operationKey ||
                `${event.source}_${event.payload.id || Date.now()}`;

            const saved = await queueRepo.add({
                eventType: event.eventType,
                source: event.source,
                payload: event.payload,
                operationKey,
                priority: event.priority || 0
            });

            if (!saved) {
                await queueRepo.addLog({
                    level: 'info',
                    message: `Duplicate event: ${operationKey}`
                });
                return res.status(200).json({
                    status: 'duplicate',
                    operationKey
                });
            }

            await queueRepo.addLog({
                queueId: saved.id,
                level: 'info',
                message: `Event accepted: ${event.eventType}`
            });

            res.status(200).json({
                status: 'accepted',
                id: saved.id
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/stats', async (req, res) => {
        const stats = await queueRepo.getStats();
        res.json(stats);
    });

    router.get('/events', async (req, res) => {
        const result = await queueRepo.getPending(20);
        res.json(result);
    });
    
    router.get('/dead', async (req, res) => {
        const result = await queueRepo.getDead(50);
        res.json(result);
    });

    return router;
}
