const axios = require('axios');

const BASE = (process.env.MOYSKLAD_API_BASE || 'https://api.moysklad.ru/api/remap/1.2').replace(/\/+$/, '');
const TOKEN = process.env.MOYSKLAD_TOKEN;
const TIMEOUT = 15000;
const PAGE_LIMIT = 100;

class MoyskladClient {
    static async _request(method, pathOrUrl, options = {}, attempt = 1) {
        if (!TOKEN) throw new Error('MOYSKLAD_TOKEN — не задан в .env');
        const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`;

        try {
            const response = await axios({
                method,
                url,
                params: options.query,
                data: options.data,
                timeout: TIMEOUT,
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Accept-Encoding': 'gzip',
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            if (attempt < 3 && (!status || status === 429 || status >= 500)) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ МойСклад retry ${attempt}/2 через ${delay}ms (${status || error.code})`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, pathOrUrl, options, attempt + 1);
            }
            const apiError = error.response?.data?.errors?.[0]?.error;
            console.error(`❌ МойСклад ${method} ${url.replace(BASE, '')} failed:`, status || '', apiError || error.message);
            throw error;
        }
    }

    static getProducts({ limit = PAGE_LIMIT, offset = 0 } = {}) {
        return this._request('GET', '/entity/product', { query: { limit, offset } });
    }

    static async getAllProducts() {
        const all = [];
        let offset = 0;
        while (true) {
            const page = await this.getProducts({ limit: PAGE_LIMIT, offset });
            const rows = page.rows || [];
            all.push(...rows);
            if (rows.length < PAGE_LIMIT) break;
            offset += PAGE_LIMIT;
        }
        return all;
    }

    static getByHref(href) {
        return this._request('GET', href);
    }

    static getStock({ limit = PAGE_LIMIT, offset = 0 } = {}) {
        return this._request('GET', '/report/stock/all', { query: { limit, offset } });
    }

    static listWebhooks() {
        return this._request('GET', '/entity/webhook');
    }

    static createWebhook(url, entityType, action) {
        return this._request('POST', '/entity/webhook', { data: { url, entityType, action } });
    }

    static async ping() {
        try {
            await this.getProducts({ limit: 1 });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.response?.status ? `HTTP ${e.response.status}` : e.message };
        }
    }
}

module.exports = MoyskladClient;
