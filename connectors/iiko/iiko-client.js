const axios = require('axios');

const IIKO_API_BASE = process.env.IIKO_API_BASE || 'https://api-ru.iiko.services';
const IIKO_API_LOGIN = process.env.IIKO_API_LOGIN;

let cachedToken = null;
let tokenExpiresAt = null;

class IikoClient {
    static async getToken() {
        if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
            return cachedToken;
        }

        if (!IIKO_API_LOGIN) {
            throw new Error('IIKO_API_LOGIN не задан в .env');
        }

        const response = await axios.post(
            `${IIKO_API_BASE}/api/1/access_token`,
            { apiLogin: IIKO_API_LOGIN },
            { headers: { 'Content-Type': 'application/json' } }
        );

        cachedToken = response.data.token;
        tokenExpiresAt = Date.now() + 60 * 60 * 1000;
        return cachedToken;
    }

    static async getOrganizations() {
        const token = await this.getToken();
        const response = await axios.post(
            `${IIKO_API_BASE}/api/1/organizations`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        );
        return response.data;
    }
}

module.exports = IikoClient;
