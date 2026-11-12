// Тесты без базы: контракт событий, разбор вебхуков, настройки, тело заказа СДЭК.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EVENTS: TS_EVENTS, validateEvent, opKey } = require('../dist/contracts/events');
const { EVENTS: JS_EVENTS } = require('../connectors/shared/events');
const { loadConfig, startupProblems } = require('../dist/config/config');
const { parseMethod, parseCountry, parseDeliveryType, normalizePhone } = require('../dist/services/intent');
const amoHook = require('../connectors/amo/webhook-server');
const cdekHook = require('../connectors/cdek/webhook-server');

const listen = app => new Promise(resolve => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
const url = (s, p) => `http://127.0.0.1:${s.address().port}${p}`;

test('контракт: коннекторы и хаб используют один список событий', () => {
    assert.deepEqual(JS_EVENTS, { ...TS_EVENTS });
    assert.equal(validateEvent('amo.deal.changed', { deal_id: 5 }), null);
    assert.match(validateEvent('amo.deal.changed', {}), /deal_id/);
    assert.match(validateEvent('cdek.order.status', { cdek_uuid: 'u' }), /code/);
    assert.match(validateEvent('marketplace.order.created', {}), /неизвестный тип/);
    assert.equal(opKey.writeoff(7), 'deal:7:writeoff');
});

test('вебхук amo: форма x-www-form-urlencoded разбирается, ключ операции детерминирован', async () => {
    const sent = [];
    const server = await listen(amoHook.createApp({ sendWithRetry: async ev => { sent.push(ev); return { status: 'accepted' }; } }));
    const form = 'leads%5Bstatus%5D%5B0%5D%5Bid%5D=555&leads%5Bstatus%5D%5B0%5D%5Bstatus_id%5D=101&leads%5Bstatus%5D%5B0%5D%5Bold_status_id%5D=100&leads%5Bstatus%5D%5B0%5D%5Bupdated_at%5D=1700000000&account%5Bsubdomain%5D=test';
    const post = () => fetch(url(server, '/webhook/amo'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    assert.equal((await post()).status, 200);
    await post();
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].payload, { deal_id: 555, kind: 'status' });
    assert.equal(sent[0].eventType, 'amo.deal.changed');
    assert.equal(sent[0].operationKey, 'amo:555:status:101:1700000000');
    assert.equal(sent[0].operationKey, sent[1].operationKey, 'повторная доставка даёт тот же ключ');

    // JSON того же вида и событие без сделок
    const r = await fetch(url(server, '/webhook/amo'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: { delete: [{ id: 9 }] } }) });
    assert.equal(r.status, 200);
    assert.equal(sent[2].eventType, 'amo.deal.deleted');
    const empty = await fetch(url(server, '/webhook/amo'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await empty.json()).status, 'ignored');
    server.close();
});

test('вебхук amo: если хаб недоступен, amo получает 502 и повторит доставку', async () => {
    const server = await listen(amoHook.createApp({ sendWithRetry: async () => { throw new Error('down'); } }));
    const r = await fetch(url(server, '/webhook/amo'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: { add: [{ id: 1 }] } }) });
    assert.equal(r.status, 502);
    server.close();
});

test('вебхук СДЭК: статус заказа превращается в событие контракта', () => {
    const ev = cdekHook.toEvent({ type: 'ORDER_STATUS', uuid: 'abc', date_time: '2026-11-01T10:00:00+0000', attributes: { code: 'DELIVERED', cdek_number: 123, status_date_time: '2026-11-01T09:59:00+0000' } });
    assert.equal(ev.eventType, 'cdek.order.status');
    assert.deepEqual(ev.payload, { cdek_uuid: 'abc', cdek_number: '123', code: 'DELIVERED', status_at: '2026-11-01T09:59:00+0000' });
    assert.equal(validateEvent(ev.eventType, ev.payload), null);
    assert.equal(cdekHook.toEvent({ type: 'PRINT_FORM', uuid: 'abc' }), null);
    const polled = cdekHook.eventsFromOrder({ uuid: 'abc', cdek_number: '123', statuses: [{ code: 'DELIVERED', date_time: 't2' }, { code: 'ACCEPTED', date_time: 't1' }] });
    assert.deepEqual(polled.map(e => e.payload.code), ['ACCEPTED', 'DELIVERED'], 'статусы идут от старых к новым');
});

test('настройки: боевой режим включается только двумя переменными', () => {
    assert.equal(loadConfig({}).mode, 'test');
    assert.equal(loadConfig({ HUB_MODE: 'live' }).mode, 'test');
    assert.equal(loadConfig({ HUB_MODE: 'live', HUB_LIVE_CONFIRM: 'yes' }).mode, 'live');
    assert.ok(startupProblems(loadConfig({})).some(p => /HUB_API_TOKEN/.test(p)));
    const live = startupProblems(loadConfig({ HUB_MODE: 'live', HUB_LIVE_CONFIRM: 'yes', HUB_API_TOKEN: 't' }));
    assert.ok(live.some(p => /AMO_STAGE_SEND/.test(p)) && live.some(p => /CDEK_TARIFF/.test(p)));
    assert.throws(() => loadConfig({ CDEK_ORDER_EXTRA_JSON: 'not json' }), /JSON/);
});

test('разбор значений полей amo и телефона', () => {
    assert.equal(parseMethod('СДЭК'), 'cdek');
    assert.equal(parseMethod('Караганда (B2B)'), 'karaganda');
    assert.equal(parseMethod('Почта'), null);
    assert.equal(parseCountry('Казахстан'), 'KZ');
    assert.equal(parseCountry('РФ'), 'RU');
    assert.equal(parseDeliveryType('До двери'), 'door');
    assert.equal(parseDeliveryType('ПВЗ'), 'pvz');
    assert.equal(normalizePhone('8 (701) 000-00-01'), '+77010000001');
    assert.equal(normalizePhone('7010000001'), '+77010000001');
    assert.equal(normalizePhone('12345'), null);
});
