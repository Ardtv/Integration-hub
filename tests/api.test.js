// API хаба и тестовый режим с настоящими шлюзами.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { freshDb, stopPostgres, testEnv, makeDeal, IDS } = require('./helpers');
const { loadConfig } = require('../dist/config/config');
const { Store } = require('../dist/store/store');
const { createApp } = require('../dist/api/app');
const { Outbound, RealAmoGateway, RealCdekGateway, RealIikoGateway, RealOnecGateway } = require('../dist/gateways/real');
const { Orchestrator } = require('../dist/services/orchestrator');
const { Documents } = require('../dist/services/documents');
const { EventHandler } = require('../dist/core/event-handler');
const { QueueWorker } = require('../dist/core/worker');

after(stopPostgres);

test('API: токен обязателен, события проверяются, дубли отбрасываются, есть ручной повтор', async () => {
    const { pool } = await freshDb();
    const store = new Store(pool);
    const server = http.createServer(createApp(store, loadConfig(testEnv()))).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, token = 'test-token') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Token': token }, body: JSON.stringify(body || {}) });
    const get = (path, token = 'test-token') => fetch(base + path, { headers: { 'X-Api-Token': token } });

    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await post('/api/events', {}, 'wrong')).status, 401);
    assert.equal((await fetch(base + '/api/admin/stats?token=test-token')).status, 401, 'токен из строки запроса не принимается');
    assert.equal((await get('/api/admin/stats', '')).status, 401);

    const ev = { eventType: 'amo.deal.changed', source: 'amo', payload: { deal_id: 77, kind: 'add' }, operationKey: 'amo:77:add::1' };
    const first = await post('/api/events', ev);
    assert.equal(first.status, 202);
    assert.equal((await (await post('/api/events', ev)).json()).status, 'duplicate');
    assert.equal((await post('/api/events', { ...ev, operationKey: 'k2', eventType: 'marketplace.order.created' })).status, 400);
    assert.equal((await post('/api/events', { ...ev, operationKey: 'k3', payload: {} })).status, 400);

    const stats = await (await get('/api/admin/stats')).json();
    assert.equal(stats.mode, 'test');
    assert.equal(stats.queue.pending, 1);
    const list = await (await get('/api/admin/events?deal_id=77')).json();
    assert.equal(list.length, 1);

    const { eventId } = await first.json();
    assert.equal((await post(`/api/admin/events/${eventId}/retry`)).status, 409, 'повтор доступен только для упавших');
    await pool.query(`UPDATE integration_queue SET status = 'dead' WHERE id = $1`, [eventId]);
    assert.equal((await post(`/api/admin/events/${eventId}/retry`)).status, 200);

    assert.equal((await fetch(base + '/api/admin/products/11', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Api-Token': 'test-token' }, body: JSON.stringify({ iiko_product_id: 'x', evil: 'drop' }) })).status, 200);
    assert.equal((await (await get('/api/admin/products')).json())[0].iiko_product_id, 'x');
    assert.equal((await get('/api/admin/deals/999')).status, 404);
    assert.equal((await fetch(base + '/panel')).status, 200);

    server.close();
    await pool.end();
});

test('тестовый режим: вся цепочка проходит, но во внешние системы ничего не записывается', async () => {
    const { pool } = await freshDb();
    const cfg = loadConfig(testEnv()); // HUB_MODE не задан → test
    const store = new Store(pool);
    const out = new Outbound(store, cfg);
    const forbidden = new Proxy({}, { get: (_t, name) => () => { throw new Error(`в тестовом режиме вызван ${String(name)}`); } });
    const deal = makeDeal(30);
    // Чтение из amo разрешено, запись запрещена
    const amoClient = {
        async getDeal() {
            return {
                id: 30, name: deal.name, price: 15000, status_id: IDS.stage.send, pipeline_id: 1, responsible_user_id: 7, updated_at: 1,
                custom_fields_values: Object.entries(deal.fields).map(([field_id, value]) => ({ field_id: Number(field_id), values: [{ value }] })),
                _embedded: { contacts: [{ id: 1, is_main: true }], catalog_elements: [{ id: 11, metadata: { quantity: 2, catalog_id: 5 } }, { id: 12, metadata: { quantity: 1, catalog_id: 5 } }] }
            };
        },
        async getContact() { return { name: 'Тест Клиент', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+77010000001' }] }] }; },
        async getCatalogElement(_c, id) { return { name: `Товар ${id}`, custom_fields_values: [{ field_code: 'PRICE', values: [{ value: '5000' }] }, { field_code: 'SKU', values: [{ value: `S${id}` }] }] }; },
        setField: forbidden.x, setStage: forbidden.x, addNote: forbidden.x, addTask: forbidden.x
    };
    const gw = {
        amo: new RealAmoGateway(cfg, out, amoClient),
        cdek: new RealCdekGateway(cfg, out, forbidden),
        iiko: new RealIikoGateway(out, forbidden),
        onec: new RealOnecGateway(cfg, out, forbidden)
    };
    const orchestrator = new Orchestrator(store, gw, cfg);
    const worker = new QueueWorker(store, new EventHandler(store, orchestrator, new Documents(store, gw, cfg)), orchestrator, { async send() {} });
    for (const id of [11, 12]) await store.setProductMap(id, { iiko_product_id: `iiko-${id}`, onec_ref: `onec-${id}` });

    await store.enqueue({ eventType: 'amo.deal.changed', source: 'amo', payload: { deal_id: 30, kind: 'status' }, operationKey: 'a1', dealId: 30 });
    await worker.drain();
    const sh = await store.getShipment(30);
    assert.equal(sh.state, 'cdek_created');
    assert.equal(sh.cdek_uuid, 'dry-30');
    assert.deepEqual((await store.getDealItems(30)).map(i => [i.amo_product_id, i.quantity, i.price_minor, i.sku]), [[11, 2, 500000, 'S11'], [12, 1, 500000, 'S12']]);

    await store.enqueue({ eventType: 'cdek.order.status', source: 'panel', payload: { cdek_uuid: 'dry-30', code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE', cdek_number: 'T-1' }, operationKey: 'c1' });
    await worker.drain();
    assert.equal((await store.queueStats()).dead, 0);
    assert.equal((await store.queueStats()).failed, 0);

    const calls = await store.listOutbound({ dealId: 30, limit: 200 });
    assert.ok(calls.length >= 6);
    assert.ok(calls.every(c => c.mode === 'test' && c.status === 'dry_run'));
    const actions = calls.map(c => `${c.system}:${c.action}`);
    for (const a of ['cdek:create_order', 'amo:set_stage', 'amo:set_field', 'iiko:create_writeoff', '1c:create:Document_РеализацияТоваровУслуг']) {
        assert.ok(actions.includes(a), `нет записи о вызове ${a}`);
    }
    const order = calls.find(c => c.action === 'create_order').request;
    assert.equal(order.number, '30');
    assert.equal(order.packages[0].items[0].ware_key, 'S11');
    await pool.end();
});
