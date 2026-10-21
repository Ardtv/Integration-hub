const axios = require('axios');

const TIMEOUT = 15000;

class MarketplaceClient {
    constructor(platform) {
        this.platform = platform;
        this.baseUrl = process.env[`${platform.toUpperCase()}_API_BASE`];
        this.apiKey = process.env[`${platform.toUpperCase()}_API_KEY`];

        if (!this.baseUrl || !this.apiKey) {
            throw new Error(`${platform.toUpperCase()}_API_BASE или ${platform.toUpperCase()}_API_KEY не заданы`);
        }
    }

    async _request(method, path, data = {}, attempt = 1) {
        try {
            const response = await axios({
                method,
                url: `${this.baseUrl}${path}`,
                data,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: TIMEOUT
            });

            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const shouldRetry = attempt < 3 && (!status || status >= 500);

            if (shouldRetry) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ ${this.platform} ${path} retry ${attempt}/2 через ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._request(method, path, data, attempt + 1);
            }

            console.error(`❌ ${this.platform} ${method} ${path} failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    async ping() {
        try {
            const result = await this._request('GET', '/health');
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }
}

module.exports = MarketplaceClient;
