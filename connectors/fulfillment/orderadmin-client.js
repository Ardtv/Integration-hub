const axios = require('axios');

const BASE = (process.env.FF_API_BASE || 'https://cdek.api.orderadmin.ru').replace(/\/+$/, '');
const TIMEOUT = 15000;
const PER_PAGE = 100;
let token = null;
let tokenExpiresAt = 0;

class OrderadminClient {
    static async getToken() {
        if (token && Date.now() < tokenExpiresAt - 60000) return token;
        const { FF_USERNAME, FF_PASSWORD, FF_DOMAIN } = process.env;
        if (!FF_USERNAME || !FF_PASSWORD) throw new Error('FF_USERNAME, FF_PASSWORD — не заданы в .env');
        const r = await axios.post(`${BASE}/oauth`, {
            grant_type: 'password', client_id: 'orderadmin', domain: FF_DOMAIN || 'cdek',
            username: FF_USERNAME, password: FF_PASSWORD
        }, { timeout: TIMEOUT });
        token = r.data.access_token;
        tokenExpiresAt = Date.now() + (r.data.expires_in || 3600) * 1000;
        return token;
    }

    static async get(path, params = {}) {
        const t = await this.getToken();
        const r = await axios.get(`${BASE}${path}`, {
            params, timeout: TIMEOUT,
            headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }
        });
        return r.data;
    }

    static async getAllOffers() {
        const all = [];
        for (let page = 1; page <= 50; page++) {
            const d = await this.get('/api/products/offer', { per_page: PER_PAGE, page });
            const rows = d._embedded?.product_offer || [];
            all.push(...rows);
            if (rows.length < PER_PAGE || page >= (d.page_count || 1)) break;
        }
        return all;
    }
}

module.exports = OrderadminClient;
