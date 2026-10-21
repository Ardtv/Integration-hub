const axios = require('axios');

const FULFILLMENT_API_BASE = process.env.FULFILLMENT_API_BASE || 'https://api.fulfillment.example.com';
const FULFILLMENT_API_KEY = process.env.FULFILLMENT_API_KEY;
const FULFILLMENT_TIMEOUT = 15000;

class FulfillmentClient {
    static async _request(method, path, data = {}, attempt = 1) {
        if (!FULFILLMENT_API_KEY) {
            throw new Error('FULFILLMENT_API_KEY не задан в .env');
        }

        try {
            const response = await axios({
                method,
                url: `${FULFILLMENT_API_BASE}${path}`,
                data,
                headers: {
                    'Authorization': `Bearer ${FULFILLMENT_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: FULFILLMENT_TIMEOUT
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const shouldRetry = attempt < 3 && (!status || status >= 500);

            if (shouldRetry) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ Fulfillment ${path} retry ${attempt}/2 через ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, path, data, attempt + 1);
            }

            console.error(`❌ Fulfillment ${method} ${path} failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    static async createShipment(shipmentData) {
        return this._request('POST', '/shipments', shipmentData);
    }

    static async getShipment(id) {
        return this._request('GET', `/shipments/${id}`);
    }

    static async updateShipmentStatus(id, status) {
        return this._request('PATCH', `/shipments/${id}`, { status });
    }

    static async getStock(warehouseId) {
        return this._request('GET', `/warehouses/${warehouseId}/stock`);
    }

    static async getWarehouses() {
        return this._request('GET', '/warehouses');
    }

    static async ping() {
        try {
            const result = await this._request('GET', '/health');
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}

module.exports = FulfillmentClient;
