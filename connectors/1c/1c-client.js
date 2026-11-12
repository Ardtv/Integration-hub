const axios = require('axios');

const BASE = (process.env.API_1C_BASE || '').replace(/\/+$/, '');
const USER = process.env.API_1C_USER;
const PASSWORD = process.env.API_1C_PASSWORD;
const TIMEOUT = 15000;

function authHeader() {
    return 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`, 'utf8').toString('base64');
}

function buildQuery(params) {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
}

class OneCClient {
    static assertConfig() {
        if (!BASE || !USER || !PASSWORD) {
            throw new Error('API_1C_BASE, API_1C_USER, API_1C_PASSWORD — не заданы в .env');
        }
    }

    static async _request(method, path, options = {}, attempt = 1) {
        this.assertConfig();
        const qs = options.query ? buildQuery(options.query) : '';
        const url = `${BASE}${path}${qs ? '?' + qs : ''}`;

        try {
            const response = await axios({
                method,
                url,
                data: options.data,
                timeout: TIMEOUT,
                headers: {
                    'Authorization': authHeader(),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            if (attempt < 3 && (!status || status >= 500)) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ 1C ${path} retry ${attempt}/2 через ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, path, options, attempt + 1);
            }
            console.error(`❌ 1C ${method} ${path} failed:`, status || '', error.response?.data || error.message);
            throw error;
        }
    }

    static async ping() {
        try {
            await this._request('GET', '/', { query: { $format: 'json' } });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.response?.status ? `HTTP ${e.response.status}` : e.message };
        }
    }

    /** Ref_Key элемента справочника по наименованию. null, если не найден. */
    static async findCatalogRefByName(catalog, name) {
        const data = await this._request('GET', `/${encodeURIComponent(catalog)}`, {
            query: { $format: 'json', $top: 1, $filter: `Description eq '${String(name).replace(/'/g, "''")}'` }
        });
        return data.value?.[0]?.Ref_Key || null;
    }

    /** Создаёт документ через стандартный интерфейс OData. Posted: false оставляет его черновиком. */
    static async createDocument(documentName, body) {
        return this._request('POST', `/${encodeURIComponent(documentName)}`, {
            query: { $format: 'json' },
            data: body
        });
    }
}

module.exports = OneCClient;
