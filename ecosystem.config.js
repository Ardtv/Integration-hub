// pm2: хаб и приёмники вебхуков. Пути считаются от расположения этого файла.
const base = { cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 3000, time: true, env: { NODE_ENV: 'production' } };

module.exports = {
    apps: [
        { ...base, name: 'hub', script: 'dist/index.js', max_memory_restart: '300M' },
        { ...base, name: 'amo-connector', script: 'connectors/amo/webhook-server.js', max_memory_restart: '150M' },
        { ...base, name: 'cdek-connector', script: 'connectors/cdek/webhook-server.js', max_memory_restart: '150M' }
    ]
};
