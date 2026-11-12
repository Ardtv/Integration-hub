// Клиент amoCRM API v4. Только транспорт: бизнес-логика живёт в хабе.
const axios = require('axios');

class AmoClient {
    constructor(token, domain, http = axios) {
        if (!token || !domain) throw new Error('AMO_API_TOKEN и AMO_API_DOMAIN не заданы');
        this.http = http;
        this.baseUrl = `https://${domain}/api/v4`;
        this.headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        this.elementCache = new Map();
    }

    async _request(method, path, data) {
        try {
            const r = await this.http({ method, url: `${this.baseUrl}${path}`, data, headers: this.headers, timeout: 15000 });
            return r.data;
        } catch (e) {
            const status = e.response?.status;
            const body = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
            const err = new Error(`amoCRM ${method} ${path}: ${status || ''} ${body}`);
            err.status = status;
            throw err;
        }
    }

    /** Сделка с контактами и позициями каталога. null, если сделки нет. */
    async getDeal(dealId) {
        try {
            return await this._request('GET', `/leads/${dealId}?with=contacts,catalog_elements`);
        } catch (e) {
            if (e.status === 404 || e.status === 204) return null;
            throw e;
        }
    }

    async getContact(contactId) {
        return this._request('GET', `/contacts/${contactId}`);
    }

    /** Элемент каталога (товар). Кэшируется на время жизни процесса. */
    async getCatalogElement(catalogId, elementId) {
        const key = `${catalogId}:${elementId}`;
        if (!this.elementCache.has(key)) {
            this.elementCache.set(key, await this._request('GET', `/catalogs/${catalogId}/elements/${elementId}`));
        }
        return this.elementCache.get(key);
    }

    async updateDeal(dealId, patch) {
        return this._request('PATCH', `/leads/${dealId}`, patch);
    }

    async setField(dealId, fieldId, value) {
        return this.updateDeal(dealId, { custom_fields_values: [{ field_id: Number(fieldId), values: [{ value: String(value) }] }] });
    }

    async setStage(dealId, statusId, pipelineId) {
        const patch = { status_id: Number(statusId) };
        if (pipelineId) patch.pipeline_id = Number(pipelineId);
        return this.updateDeal(dealId, patch);
    }

    async addNote(dealId, text) {
        return this._request('POST', `/leads/${dealId}/notes`, [{ note_type: 'common', params: { text: String(text) } }]);
    }

    async addTask(dealId, text, responsibleUserId) {
        const task = {
            text: String(text),
            entity_id: Number(dealId),
            entity_type: 'leads',
            complete_till: Math.floor(Date.now() / 1000) + 24 * 3600
        };
        if (responsibleUserId) task.responsible_user_id = Number(responsibleUserId);
        return this._request('POST', '/tasks', [task]);
    }

    // ── для скриптов настройки ──
    async listPipelines() { return (await this._request('GET', '/leads/pipelines'))?._embedded?.pipelines || []; }
    async listLeadFields() { return (await this._request('GET', '/leads/custom_fields?limit=250'))?._embedded?.custom_fields || []; }
    async listCatalogs() { return (await this._request('GET', '/catalogs'))?._embedded?.catalogs || []; }
    async createLeadFields(fields) { return (await this._request('POST', '/leads/custom_fields', fields))?._embedded?.custom_fields || []; }
    async createStatuses(pipelineId, statuses) {
        return (await this._request('POST', `/leads/pipelines/${pipelineId}/statuses`, statuses))?._embedded?.statuses || [];
    }
}

module.exports = AmoClient;
