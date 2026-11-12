// Клиент для отправки событий в хаб. Используется всеми коннекторами.
const axios = require('axios');

const HUB_URL = (process.env.HUB_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');

async function send(event, attempt = 1) {
    try {
        const r = await axios.post(`${HUB_URL}/api/events`, event, {
            headers: { 'Content-Type': 'application/json', 'X-Api-Token': process.env.HUB_API_TOKEN || '' },
            timeout: 5000
        });
        return r.data;
    } catch (e) {
        const status = e.response?.status;
        // 4xx — ошибка в самом событии, повтор не поможет.
        if (attempt < 3 && (!status || status >= 500)) {
            await new Promise(r => setTimeout(r, attempt * 500));
            return send(event, attempt + 1);
        }
        const err = new Error(`Hub ${status || ''}: ${e.response?.data?.error || e.message}`);
        err.status = status;
        throw err;
    }
}

module.exports = { sendWithRetry: send, send };
