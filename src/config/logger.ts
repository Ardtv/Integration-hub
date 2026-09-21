import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
        service: 'integration-hub'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: isProduction ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' }
    }
});
