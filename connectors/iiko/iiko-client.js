const axios = require('axios');

const IIKO_API_BASE = process.env.IIKO_API_BASE || 'https://api-ru.iiko.services';
const IIKO_API_KEY = process.env.IIKO_API_KEY;
const IIKO_APP_ID = process.env.IIKO_APP_ID;
const IIKO_CLIENT_SECRET = process.env.IIKO_CLIENT_SECRET;
const IIKO_TIMEOUT = 15000;

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
    }

    static async getOrganizations() {
        const token = await this.getToken();
        const response = await axios.post(
            `${IIKO_API_BASE}/api/1/organizations`,
            {},
            {
                headers: { Authorization: `Bearer ${token}` },
                timeout: IIKO_TIMEOUT
            }
        );
        return response.data;
    }
}

module.exports = IikoClient;
