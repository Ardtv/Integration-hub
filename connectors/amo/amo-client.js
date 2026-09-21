// connectors/amo/amo-client.js
const axios = require('axios');

class AmoClient {
    constructor(apiKey, domain) {
        this.apiKey = apiKey;
        this.baseUrl = `https://${domain}/api/v4`;
    }

    async getDeal(dealId) {
        const response = await axios.get(
            `${this.baseUrl}/leads/${dealId}`,
            { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );
        return response.data;
    }

async getDealProducts(dealId) {
    try {
        const response = await axios.get(
            `${this.baseUrl}/leads/${dealId}/catalog_elements`,
            { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );
        return response.data._embedded?.items || [];
    } catch (error) {
        // Если товаров нет, возвращаем пустой массив
        if (error.response?.status === 404) {
            console.log(`ℹ️ Товары не найдены для сделки ${dealId}`);
            return [];
        }
        throw error;
    }
}
    async getContact(contactId) {
        const response = await axios.get(
            `${this.baseUrl}/contacts/${contactId}`,
            { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );
        return response.data;
    }

    async updateDealStatus(dealId, statusId) {
        await axios.patch(
            `${this.baseUrl}/leads/${dealId}`,
            { status_id: statusId },
            { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );
    }
}

module.exports = AmoClient;
