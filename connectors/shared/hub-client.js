const axios = require('axios');

const HUB_URL = process.env.HUB_URL || 'http://localhost:3001';
const MAX_ATTEMPTS = 3;

class HubClient {
    static async sendEvent(eventData) {
        try {
            const response = await axios.post(
                `${HUB_URL}/api/events`,
                eventData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Token': process.env.HUB_API_TOKEN
                    },
                    timeout: 5000
                }
            );
            return response.data;
        } catch (error) {
            console.error('❌ Failed to send to hub:', error.response?.data || error.message);
            throw error;
        }
    }

    static async sendWithRetry(eventData, attempt = 1) {
        try {
            return await this.sendEvent(eventData);
        } catch (error) {
            if (attempt < MAX_ATTEMPTS) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`⏳ Retry ${attempt}/${MAX_ATTEMPTS - 1} через ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return this.sendWithRetry(eventData, attempt + 1);
            }
            console.error(`❌ Все ${MAX_ATTEMPTS} попытки исчерпаны`);
            throw error;
        }
    }

    static async getEventStatus(eventId) {
        const response = await axios.get(`${HUB_URL}/api/events/${eventId}`, {
            headers: {
                'X-Api-Token': process.env.HUB_API_TOKEN
            }
        });
        return response.data;
    }

    static async healthCheck() {
        try {
            const response = await axios.get(`${HUB_URL}/health`);
            return response.data;
        } catch (error) {
            console.error('❌ Hub health check failed:', error.message);
            return null;
        }
    }
}

module.exports = HubClient;

