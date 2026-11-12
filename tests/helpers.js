// Общая обвязка тестов: настоящий PostgreSQL (embedded-postgres), миграции, подменённые внешние системы.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Pool } = require('pg');
const { migrate } = require('../scripts/migrate');
const { loadConfig } = require('../dist/config/config');
const { Store } = require('../dist/store/store');
const { Orchestrator } = require('../dist/services/orchestrator');
const { Documents } = require('../dist/services/documents');
const { EventHandler } = require('../dist/core/event-handler');
const { QueueWorker } = require('../dist/core/worker');

const IDS = {
    stage: { send: 101, created: 102, delivered: 103, error: 104, returned: 105, other: 100 },
    field: { method: 201, country: 202, type: 203, city: 204, address: 205, pvz: 206, track: 207 }
};

function testEnv(extra = {}) {
    return {
        HUB_API_TOKEN: 'test-token',
        AMO_STAGE_SEND: String(IDS.stage.send), AMO_STAGE_CREATED: String(IDS.stage.created),
        AMO_STAGE_DELIVERED: String(IDS.stage.delivered), AMO_STAGE_ERROR: String(IDS.stage.error), AMO_STAGE_RETURN: String(IDS.stage.returned),
        AMO_FIELD_METHOD: String(IDS.field.method), AMO_FIELD_COUNTRY: String(IDS.field.country), AMO_FIELD_DELIVERY_TYPE: String(IDS.field.type),
        AMO_FIELD_CITY: String(IDS.field.city), AMO_FIELD_ADDRESS: String(IDS.field.address), AMO_FIELD_PVZ: String(IDS.field.pvz), AMO_FIELD_TRACK: String(IDS.field.track),
        CDEK_TARIFF_DOOR: '137', CDEK_TARIFF_PVZ: '136', CDEK_SHIPMENT_POINT: 'TEST1',
        IIKO_WRITEOFF_ENABLED: 'true', IIKO_ORGANIZATION_ID: 'org', IIKO_STORE_ID: 'store', IIKO_EXPENSE_ACCOUNT_ID: 'acc', IIKO_DEFAULT_UNIT_ID: 'unit',
        API_1C_ENABLED: 'true',
        ...extra
    };
}

let pg = null, adminPool = null, dbCounter = 0;

async function startPostgres() {
    if (pg) return;
    const EP = require('embedded-postgres').default || require('embedded-postgres');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-pg-'));
    const port = 54000 + Math.floor(Math.random() * 900);
    pg = new EP({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false, createPostgresUser: true, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    pg._port = port;
    adminPool = new Pool({ host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' });
}

async function stopPostgres() {
    if (adminPool) await adminPool.end();
    if (pg) await pg.stop();
    pg = null; adminPool = null;
}

/** Чистая база с применёнными миграциями. */
async function freshDb() {
    await startPostgres();
    const name = `hub_test_${process.pid}_${++dbCounter}`;
    await adminPool.query(`CREATE DATABASE ${name}`);
    const pool = new Pool({ host: 'localhost', port: pg._port, user: 'postgres', password: 'pw', database: name });
    const applied = await migrate(pool);
    return { pool, applied };
}

/** Подменённые amo, СДЭК, IIKO и 1С. Запоминают все вызовы на запись. */
function fakeGateways() {
    const calls = [];
    const deals = new Map();
    const cdekOrders = new Map();
    const gw = {
        calls,
        deals,
        cdekOrders,
        failNext: {},
        existingByNumber: {},
        amo: {
            async getDeal(id) { const d = deals.get(id); return d ? JSON.parse(JSON.stringify(d)) : null; },
            async setField(id, fieldId, value) { calls.push({ sys: 'amo', op: 'setField', id, fieldId, value }); deals.get(id).fields[String(fieldId)] = value; },
            async setStage(id, statusId) { calls.push({ sys: 'amo', op: 'setStage', id, statusId }); deals.get(id).status_id = statusId; },
            async addNote(id, text) { calls.push({ sys: 'amo', op: 'addNote', id, text }); },
            async addTask(id, text) { calls.push({ sys: 'amo', op: 'addTask', id, text }); }
        },
        cdek: {
            async createOrder(id, body) {
                if (gw.failNext.cdekCreate) { const e = gw.failNext.cdekCreate; gw.failNext.cdekCreate = null; throw e; }
                const uuid = `uuid-${id}-${cdekOrders.size + 1}`;
                cdekOrders.set(uuid, { uuid, cdek_number: null, statuses: [], body });
                calls.push({ sys: 'cdek', op: 'createOrder', id, body });
                return { uuid };
            },
            async updateOrder(id, body) { calls.push({ sys: 'cdek', op: 'updateOrder', id, body }); },
            async findByImNumber(n) { return gw.existingByNumber[n] || null; },
            async getOrder(uuid) { return cdekOrders.get(uuid) || null; }
        },
        iiko: {
            async createWriteoff(id, body) {
                if (gw.failNext.iiko) { const e = gw.failNext.iiko; if (!gw.failAlways) gw.failNext.iiko = null; throw e; }
                calls.push({ sys: 'iiko', op: 'createWriteoff', id, body });
                return { id: `wo-${id}` };
            }
        },
        onec: {
            async findCounterpartyRef(catalog, name) { calls.push({ sys: '1c', op: 'findCounterparty', name }); return `ref:${name}`; },
            async createDocument(id, doc, body) { calls.push({ sys: '1c', op: 'createDocument', id, doc, body }); return { ref: `1c-${id}`, number: `N-${id}` }; }
        }
    };
    return gw;
}

function makeDeal(id, over = {}) {
    return {
        id, name: `Сделка ${id}`, price_minor: 1500000, status_id: IDS.stage.send, pipeline_id: 1, responsible_user_id: 7, updated_at: 1,
        fields: {
            [IDS.field.method]: 'СДЭК', [IDS.field.country]: 'Казахстан', [IDS.field.type]: 'До двери',
            [IDS.field.city]: 'Алматы', [IDS.field.address]: 'ул. Абая, 1, кв. 2'
        },
        contact: { name: 'Тест Клиент', phone: '+7 701 000 00 01', email: null },
        items: [
            { amo_product_id: 11, name: 'Relax Time', sku: 'RT-1', quantity: 2, price_minor: 500000 },
            { amo_product_id: 12, name: 'Mind Drops', sku: 'MD-1', quantity: 1, price_minor: 500000 }
        ],
        ...over
    };
}

/** Собирает хаб на чистой базе с подменёнными системами. */
async function makeHub(envExtra = {}, opts = {}) {
    const { pool } = await freshDb();
    const cfg = loadConfig(testEnv(envExtra));
    const store = new Store(pool);
    const gw = opts.gateways || fakeGateways();
    const alerts = [];
    const alerter = { async send(t) { alerts.push(t); } };
    const orchestrator = new Orchestrator(store, gw, cfg);
    const documents = new Documents(store, gw, cfg);
    const worker = new QueueWorker(store, new EventHandler(store, orchestrator, documents), orchestrator, alerter);
    if (opts.mapProducts !== false) {
        for (const id of [11, 12]) await store.setProductMap(id, { iiko_product_id: `iiko-${id}`, onec_ref: `onec-${id}`, cdek_sku: `SKU${id}`, weight_g: 300 });
    }
    let seq = 0;
    return {
        pool, cfg, store, gw, alerts, worker, orchestrator, documents,
        async dealChanged(id) {
            await store.enqueue({ eventType: 'amo.deal.changed', source: 'amo', payload: { deal_id: id, kind: 'update' }, operationKey: `t:${id}:${++seq}`, dealId: id });
            return worker.drain();
        },
        async cdekStatus(uuid, code, extra = {}) {
            await store.enqueue({ eventType: 'cdek.order.status', source: 'cdek', payload: { cdek_uuid: uuid, code, ...extra }, operationKey: `c:${uuid}:${code}:${++seq}` });
            return worker.drain();
        },
        count(sys, op) { return gw.calls.filter(c => c.sys === sys && c.op === op).length; },
        last(sys, op) { return gw.calls.filter(c => c.sys === sys && c.op === op).pop(); },
        notes(id) { return gw.calls.filter(c => c.op === 'addNote' && c.id === id).map(c => c.text); },
        async close() { await pool.end(); }
    };
}

module.exports = { IDS, testEnv, freshDb, stopPostgres, fakeGateways, makeDeal, makeHub };
