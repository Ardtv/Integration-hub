const axios = require('axios');

const IIKO_API_BASE = process.env.IIKO_API_BASE || 'https://api-ru.iiko.services';
const IIKO_API_KEY = process.env.IIKO_API_KEY;
const IIKO_APP_ID = process.env.IIKO_APP_ID;
const IIKO_CLIENT_SECRET = process.env.IIKO_CLIENT_SECRET;
const IIKO_TIMEOUT = 15000;
const IIKO_MAX_RETRIES = 3;

let cachedToken = null;
let tokenExpiresAt = null;

class IikoClient {
    static async getToken() {
        if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt - 60000) {
            return cachedToken;
        }

        if (!IIKO_API_KEY || !IIKO_APP_ID || !IIKO_CLIENT_SECRET) {
            throw new Error('IIKO_API_KEY, IIKO_APP_ID, IIKO_CLIENT_SECRET — не все заданы в .env');
        }

        try {
            const response = await axios.post(
                `${IIKO_API_BASE}/api/v2/access_token`,
                {
                    apiKey: IIKO_API_KEY,
                    appId: IIKO_APP_ID,
                    clientSecret: IIKO_CLIENT_SECRET
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: IIKO_TIMEOUT
                }
            );

            if (response.data.correlationId) {
                console.log(`ℹ️ IIKO correlationId: ${response.data.correlationId}`);
            }

            cachedToken = response.data.token;
            tokenExpiresAt = Date.now() + 60 * 60 * 1000;
            return cachedToken;
        } catch (error) {
            const body = error.response?.data;
            console.error('❌ IIKO getToken failed:', {
                status: error.response?.status,
                body: body ? JSON.stringify(body) : error.message
            });
            throw error;
        }
    }

    static async _request(method, path, data = {}, attempt = 1) {
        const token = await this.getToken();

        try {
            const response = await axios({
                method,
                url: `${IIKO_API_BASE}${path}`,
                data,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: IIKO_TIMEOUT
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const body = error.response?.data;

            const shouldRetry = (
                attempt < IIKO_MAX_RETRIES &&
                (!status || status >= 500 || error.code === 'ECONNABORTED')
            );

            if (shouldRetry) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ IIKO ${path} retry ${attempt}/${IIKO_MAX_RETRIES - 1} через ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, path, data, attempt + 1);
            }

            console.error(`❌ IIKO ${method} ${path} failed:`, {
                status,
                body: body ? JSON.stringify(body) : error.message
            });
            throw error;
        }
    }

    static async getOrganizations() {
        return this._request('POST', '/api/1/organizations', {});
    }

    static async getTerminalGroups(organizationId) {
        return this._request('POST', '/api/1/terminal_groups', {
            organizationIds: [organizationId]
        });
    }

    static async getNomenclature(organizationId) {
        return this._request('POST', '/api/1/nomenclature', {
            organizationId
        });
    }

    static async getStopList(organizationId) {
        return this._request('POST', '/api/1/stop_lists', {
            organizationIds: [organizationId]
        });
    }

    static async createDeliveryOrder(organizationId, terminalGroupId, order) {
        return this._request('POST', '/api/1/deliveries/create', {
            organizationId,
            terminalGroupId,
            order
        });
    }

    static async getOrderById(organizationId, orderId) {
        return this._request('POST', '/api/1/deliveries/by_id', {
            organizationIds: [organizationId],
            orderIds: [orderId]
        });
    }

    static async getOrdersByDate(organizationId, dateFrom, dateTo) {
        return this._request('POST', '/api/1/deliveries/by_delivery_date_and_status', {
            organizationIds: [organizationId],
            deliveryDateFrom: dateFrom,
            deliveryDateTo: dateTo
        });
    }

    static async getStockBalance(organizationId) {
        return this._request('POST', '/api/1/stock/balance', {
            organizationId
        });
    }

    static async ping() {
        try {
            const token = await this.getToken();
            return { ok: true, token: token.substring(0, 20) + '...' };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
    /**
     * Список внешних меню
     */
    static async getExternalMenus(organizationId) {
        return this._request('POST', '/api/2/menu', {
            organizationId
        });
    }

    /**
     * Состав внешнего меню
     */
    static async getExternalMenuById(organizationIds, externalMenuId) {
        return this._request('POST', '/api/2/menu/by_id', {
            organizationIds: [organizationIds],
            externalMenuId
        });
    }
}

module.exports = IikoClient;
