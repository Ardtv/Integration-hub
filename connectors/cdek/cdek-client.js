const axios = require('axios');

// Боевой контур: https://api.cdek.ru/v2, тестовый: https://api.edu.cdek.ru/v2
const CDEK_API_BASE = (process.env.CDEK_API_BASE || 'https://api.cdek.ru/v2').replace(/\/+$/, '');
const CDEK_CLIENT_ID = process.env.CDEK_CLIENT_ID;
const CDEK_CLIENT_SECRET = process.env.CDEK_CLIENT_SECRET;
const CDEK_TIMEOUT = 15000;

let cachedToken = null;
let tokenExpiresAt = null;

class CdekClient {
    static async getToken() {
        if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
            return cachedToken;
        }

        if (!CDEK_CLIENT_ID || !CDEK_CLIENT_SECRET) {
            throw new Error('CDEK_CLIENT_ID, CDEK_CLIENT_SECRET — не заданы в .env');
        }

        try {
            const response = await axios.post(
                `${CDEK_API_BASE}/oauth/token`,
                new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: CDEK_CLIENT_ID,
                    client_secret: CDEK_CLIENT_SECRET
                }),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: CDEK_TIMEOUT
                }
            );

            cachedToken = response.data.access_token;
            tokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000;
            return cachedToken;
        } catch (error) {
            console.error('❌ CDEK getToken failed:', error.response?.data || error.message);
            throw error;
        }
    }

    static async _request(method, path, data = {}, attempt = 1) {
        const token = await this.getToken();

        try {
            const response = await axios({
                method,
                url: `${CDEK_API_BASE}${path}`,
                data: (method === 'GET' || method === 'DELETE') ? undefined : data,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: CDEK_TIMEOUT
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const shouldRetry = attempt < 3 && (!status || status >= 500);

            if (shouldRetry) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ CDEK ${path} retry ${attempt}/2 через ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, path, data, attempt + 1);
            }

            console.error(`❌ CDEK ${method} ${path} failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    static async createOrder(orderData) {
        return this._request('POST', '/orders', orderData);
    }

    /** Изменение заказа: тело должно содержать uuid и изменяемые поля. */
    static async updateOrder(orderData) {
        return this._request('PATCH', '/orders', orderData);
    }

    static async cancelOrder(uuid) {
        return this._request('DELETE', `/orders/${uuid}`);
    }

    static async getOrder(uuid) {
        return this._request('GET', `/orders/${uuid}`);
    }

    /** Поиск заказа по номеру в нашей системе (мы передаём туда ID сделки). */
    static async getOrderByImNumber(imNumber) {
        try {
            return await this._request('GET', `/orders?im_number=${encodeURIComponent(imNumber)}`);
        } catch (e) {
            if (e.response?.status === 404 || e.response?.status === 400) return null;
            throw e;
        }
    }

    static async getDeliveryPoints(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this._request('GET', `/deliverypoints${qs ? '?' + qs : ''}`);
    }

    static async calculateTariff(data) {
        return this._request('POST', '/calculator/tariff', data);
    }

    /** Подписка на вебхуки статусов заказов. */
    static async subscribeWebhook(url, type = 'ORDER_STATUS') {
        return this._request('POST', '/webhooks', { url, type });
    }

    static async listWebhooks() {
        return this._request('GET', '/webhooks');
    }

    static async ping() {
        try {
            const token = await this.getToken();
            return { ok: true, token: token.substring(0, 20) + '...' };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}

module.exports = CdekClient;
