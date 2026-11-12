// Сквозные сценарии Этапа 2.1 на настоящем PostgreSQL с подменёнными внешними системами.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, makeHub, makeDeal, stopPostgres, freshDb } = require('./helpers');
const { migrate } = require('../scripts/migrate');

after(stopPostgres);

const uuidOf = async (hub, id) => (await hub.store.getShipment(id)).cdek_uuid;

test('миграции применяются на пустой базе и повторный запуск ничего не ломает', async () => {
    const { pool, applied } = await freshDb();
    assert.deepEqual(applied, ['001_core.sql', '002_stage2_1.sql']);
    assert.deepEqual(await migrate(pool), []);
    const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map(r => r.table_name);
    for (const t of ['integration_queue', 'deals', 'deal_items', 'shipments', 'product_map', 'stock_documents', 'outbound_calls', 'external_products', 'ff_offers']) {
        assert.ok(tables.includes(t), `нет таблицы ${t}`);
    }
    for (const t of ['orders', 'users', 'marketplace_orders', 'moysklad_products']) assert.ok(!tables.includes(t), `лишняя таблица ${t}`);
    await pool.end();
});

test('СДЭК, Казахстан, до двери: полный путь от сделки до доставки', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(1, makeDeal(1));

    await hub.dealChanged(1);
    let sh = await hub.store.getShipment(1);
    assert.equal(sh.state, 'cdek_created');
    assert.equal(hub.count('cdek', 'createOrder'), 1);
    const body = hub.last('cdek', 'createOrder').body;
    assert.equal(body.number, '1');
    assert.equal(body.tariff_code, 137);
    assert.equal(body.to_location.city, 'Алматы');
    assert.equal(body.to_location.country_code, 'KZ');
    assert.equal(body.recipient.phones[0].number, '+77010000001');
    assert.equal(body.shipment_point, 'TEST1');
    // Наложенный платёж равен сумме сделки
    const cod = body.packages[0].items.reduce((s, i) => s + i.payment.value * i.amount, 0);
    assert.equal(cod, 15000);
    assert.equal(body.packages[0].weight, 900);
    assert.equal(hub.gw.deals.get(1).status_id, IDS.stage.created);

    // СДЭК присвоил номер: трек пишется в поле сделки
    await hub.cdekStatus(sh.cdek_uuid, 'ACCEPTED', { cdek_number: '1234567890' });
    assert.equal(hub.gw.deals.get(1).fields[IDS.field.track], '1234567890');
    assert.equal(hub.gw.deals.get(1).status_id, IDS.stage.created, 'промежуточный статус этап не двигает');

    // Отгрузка со склада: списание в IIKO и черновик реализации в 1С
    await hub.cdekStatus(sh.cdek_uuid, 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    assert.equal((await hub.store.getShipment(1)).state, 'shipped');
    assert.equal(hub.count('iiko', 'createWriteoff'), 1);
    const wo = hub.last('iiko', 'createWriteoff').body;
    assert.deepEqual(wo.items.map(i => [i.product, i.amount]), [['iiko-11', 2], ['iiko-12', 1]]);
    assert.equal(wo.storeFrom, 'store');
    const sale = hub.last('1c', 'createDocument');
    assert.equal(sale.doc, 'Document_РеализацияТоваровУслуг');
    assert.equal(sale.body.Posted, false, 'реализация создаётся черновиком');
    assert.equal(sale.body['Контрагент_Key'], 'ref:Розница');
    assert.equal(sale.body['Товары'].length, 2);

    // Следующие статусы отгрузки не создают документы повторно
    await hub.cdekStatus(sh.cdek_uuid, 'TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY');
    assert.equal(hub.count('iiko', 'createWriteoff'), 1);
    assert.equal(hub.count('1c', 'createDocument'), 1);

    await hub.cdekStatus(sh.cdek_uuid, 'DELIVERED');
    sh = await hub.store.getShipment(1);
    assert.equal(sh.state, 'delivered');
    assert.equal(hub.gw.deals.get(1).status_id, IDS.stage.delivered);

    const docs = await hub.store.listStockDocs(1);
    assert.deepEqual(docs.map(d => [d.kind, d.status]), [['writeoff', 'done'], ['sale', 'done']]);
    assert.equal((await hub.store.queueStats()).dead, 0);
    await hub.close();
});

test('СДЭК, Россия, ПВЗ: код пункта, тариф ПВЗ, контрагент «Розница РФ»', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(2, makeDeal(2, { fields: { [IDS.field.method]: 'СДЭК', [IDS.field.country]: 'Россия', [IDS.field.type]: 'ПВЗ', [IDS.field.pvz]: 'MSK123' } }));
    await hub.dealChanged(2);
    const body = hub.last('cdek', 'createOrder').body;
    assert.equal(body.delivery_point, 'MSK123');
    assert.equal(body.tariff_code, 136);
    assert.equal(body.to_location, undefined);
    await hub.cdekStatus(await uuidOf(hub, 2), 'READY_FOR_SHIPMENT_IN_SENDER_CITY');
    assert.equal(hub.last('1c', 'createDocument').body['Контрагент_Key'], 'ref:Розница РФ');
    await hub.close();
});

test('Караганда (B2B): заявка в СДЭК не создаётся', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(3, makeDeal(3, { fields: { [IDS.field.method]: 'Караганда (B2B)' } }));
    await hub.dealChanged(3);
    await hub.dealChanged(3);
    assert.equal(hub.count('cdek', 'createOrder'), 0);
    assert.equal((await hub.store.getShipment(3)).state, 'manual');
    assert.equal(hub.notes(3).length, 1, 'примечание пишется один раз');
    await hub.close();
});

test('сделка не на этапе отправки ничего не запускает', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(4, makeDeal(4, { status_id: IDS.stage.other }));
    await hub.dealChanged(4);
    assert.equal(hub.count('cdek', 'createOrder'), 0);
    assert.equal(await hub.store.getShipment(4), null);
    assert.ok(await hub.store.getDeal(4), 'сделка при этом сохранена в базе хаба');
    await hub.close();
});

test('повтор события и возврат на этап отправки не создают вторую заявку', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(5, makeDeal(5));
    await hub.dealChanged(5);
    await hub.dealChanged(5);
    hub.gw.deals.get(5).status_id = IDS.stage.send; // менеджер откатил этап и перевёл снова
    await hub.dealChanged(5);
    assert.equal(hub.count('cdek', 'createOrder'), 1);

    // Один и тот же вебхук, доставленный дважды, попадает в очередь один раз
    const ev = { eventType: 'amo.deal.changed', source: 'amo', payload: { deal_id: 5, kind: 'status' }, operationKey: 'amo:5:status:101:1700000000', dealId: 5 };
    assert.ok(await hub.store.enqueue(ev));
    assert.equal(await hub.store.enqueue(ev), null);
    await hub.close();
});

test('смена ПВЗ до отгрузки обновляет заявку, а не создаёт новую', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(6, makeDeal(6, { fields: { [IDS.field.method]: 'СДЭК', [IDS.field.country]: 'Казахстан', [IDS.field.type]: 'ПВЗ', [IDS.field.pvz]: 'ALA1' } }));
    await hub.dealChanged(6);
    hub.gw.deals.get(6).fields[IDS.field.pvz] = 'ALA2';
    await hub.dealChanged(6);
    assert.equal(hub.count('cdek', 'createOrder'), 1);
    assert.equal(hub.count('cdek', 'updateOrder'), 1);
    const upd = hub.last('cdek', 'updateOrder').body;
    assert.equal(upd.delivery_point, 'ALA2');
    assert.equal(upd.uuid, await uuidOf(hub, 6));
    assert.equal((await hub.store.getShipment(6)).pvz_code, 'ALA2');
    await hub.dealChanged(6); // без изменений — без вызовов
    assert.equal(hub.count('cdek', 'updateOrder'), 1);
    await hub.close();
});

test('смена адреса после отгрузки: заявка не трогается, менеджер получает задачу', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(7, makeDeal(7));
    await hub.dealChanged(7);
    await hub.cdekStatus(await uuidOf(hub, 7), 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    const tasksBefore = hub.count('amo', 'addTask');
    hub.gw.deals.get(7).fields[IDS.field.address] = 'другой адрес';
    await hub.dealChanged(7);
    await hub.dealChanged(7);
    assert.equal(hub.count('cdek', 'updateOrder'), 0);
    assert.equal(hub.count('amo', 'addTask'), tasksBefore + 1, 'задача ставится один раз');
    await hub.close();
});

test('отказ после отгрузки: возвратные документы создаются один раз', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(8, makeDeal(8));
    await hub.dealChanged(8);
    const uuid = await uuidOf(hub, 8);
    await hub.cdekStatus(uuid, 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    await hub.cdekStatus(uuid, 'NOT_DELIVERED');
    await hub.cdekStatus(uuid, 'NOT_DELIVERED');
    assert.equal((await hub.store.getShipment(8)).state, 'returned');
    assert.equal(hub.gw.deals.get(8).status_id, IDS.stage.returned);
    const docs = Object.fromEntries((await hub.store.listStockDocs(8)).map(d => [d.kind, d.status]));
    assert.deepEqual(docs, { writeoff: 'done', sale: 'done', return_iiko: 'skipped', return_1c: 'done' });
    const ret = hub.gw.calls.filter(c => c.op === 'createDocument' && c.doc === 'Document_ВозвратТоваровОтКлиента');
    assert.equal(ret.length, 1);
    assert.equal(ret[0].body.Posted, false);
    assert.ok(hub.gw.calls.some(c => c.op === 'addTask' && /Возврат в IIKO/.test(c.text)), 'по возврату в IIKO менеджеру ставится задача');
    await hub.close();
});

test('отказ до отгрузки: документы не создаются', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(9, makeDeal(9));
    await hub.dealChanged(9);
    await hub.cdekStatus(await uuidOf(hub, 9), 'NOT_DELIVERED');
    assert.equal((await hub.store.getShipment(9)).state, 'cancelled');
    assert.equal((await hub.store.listStockDocs(9)).length, 0);
    await hub.close();
});

test('«доставлено» без статуса отгрузки всё равно создаёт документы один раз', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(10, makeDeal(10));
    await hub.dealChanged(10);
    const uuid = await uuidOf(hub, 10);
    await hub.cdekStatus(uuid, 'DELIVERED');
    await hub.cdekStatus(uuid, 'DELIVERED');
    assert.equal(hub.count('iiko', 'createWriteoff'), 1);
    assert.equal(hub.count('1c', 'createDocument'), 1);
    assert.equal((await hub.store.getShipment(10)).state, 'delivered');
    await hub.close();
});

test('несопоставленный товар: заявка не уходит, сделка на этапе ошибки', async () => {
    const hub = await makeHub({}, { mapProducts: false });
    hub.gw.deals.set(11, makeDeal(11));
    await hub.dealChanged(11);
    const sh = await hub.store.getShipment(11);
    assert.equal(sh.state, 'error');
    assert.match(sh.error, /Relax Time.*не сопоставлен с IIKO/s);
    assert.equal(hub.count('cdek', 'createOrder'), 0);
    assert.equal(hub.gw.deals.get(11).status_id, IDS.stage.error);
    assert.equal(hub.count('amo', 'addTask'), 1);
    // Товары появились в справочнике как несопоставленные
    assert.deepEqual((await hub.store.listProductMap(true)).map(p => p.amo_product_id).sort(), [11, 12]);

    // Менеджер сопоставил товары и вернул сделку на этап отправки
    for (const id of [11, 12]) await hub.store.setProductMap(id, { iiko_product_id: `iiko-${id}`, onec_ref: `onec-${id}` });
    hub.gw.deals.get(11).status_id = IDS.stage.send;
    await hub.dealChanged(11);
    assert.equal((await hub.store.getShipment(11)).state, 'cdek_created');
    assert.equal(hub.count('cdek', 'createOrder'), 1);
    await hub.close();
});

test('проверка полей: понятный список ошибок', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(12, makeDeal(12, {
        price_minor: 999, contact: { name: null, phone: '123', email: null },
        fields: { [IDS.field.method]: 'СДЭК', [IDS.field.type]: 'До двери' }
    }));
    await hub.dealChanged(12);
    const err = (await hub.store.getShipment(12)).error;
    for (const part of ['Страна', 'Город', 'Адрес', 'нет имени', 'нет телефона', 'Бюджет сделки']) assert.match(err, new RegExp(part));
    assert.equal(hub.count('cdek', 'createOrder'), 0);

    hub.gw.deals.set(13, makeDeal(13, { fields: {} }));
    await hub.dealChanged(13);
    assert.match((await hub.store.getShipment(13)).error, /Способ отправки/);
    await hub.close();
});

test('СДЭК отклонил заявку (4xx): ошибка оформления без бесконечных повторов', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(14, makeDeal(14));
    hub.gw.failNext.cdekCreate = Object.assign(new Error('bad request'), { response: { status: 400, data: { requests: [{ errors: [{ message: 'Неверный тариф' }] }] } } });
    await hub.dealChanged(14);
    const sh = await hub.store.getShipment(14);
    assert.equal(sh.state, 'error');
    assert.match(sh.error, /Неверный тариф/);
    assert.equal((await hub.store.queueStats()).failed, 0);
    await hub.close();
});

test('асинхронный отказ СДЭК (INVALID) переводит сделку на этап ошибки', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(15, makeDeal(15));
    await hub.dealChanged(15);
    await hub.cdekStatus(await uuidOf(hub, 15), 'INVALID');
    assert.equal((await hub.store.getShipment(15)).state, 'error');
    assert.equal(hub.gw.deals.get(15).status_id, IDS.stage.error);
    await hub.close();
});

test('сбой после создания заказа в СДЭК: существующий заказ подхватывается, второй не создаётся', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(16, makeDeal(16));
    await hub.store.upsertDeal({ id: 16, pipeline_id: 1, status_id: IDS.stage.send, name: 'x', price_minor: 0, customer_name: null, customer_phone: null, customer_email: null, responsible_user_id: null, fields: {} }, []);
    await hub.store.saveShipment(16, { state: 'validated' });
    hub.gw.existingByNumber['16'] = { uuid: 'uuid-existing', cdek_number: '777', statuses: [{ code: 'ACCEPTED' }] };
    await hub.dealChanged(16);
    const sh = await hub.store.getShipment(16);
    assert.equal(sh.cdek_uuid, 'uuid-existing');
    assert.equal(sh.state, 'cdek_created');
    assert.equal(hub.count('cdek', 'createOrder'), 0);
    assert.equal(hub.gw.deals.get(16).fields[IDS.field.track], '777');
    await hub.close();
});

test('временная ошибка IIKO: повтор по очереди, списание создаётся один раз', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(17, makeDeal(17));
    await hub.dealChanged(17);
    hub.gw.failNext.iiko = new Error('IIKO 503');
    await hub.cdekStatus(await uuidOf(hub, 17), 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    let ev = (await hub.store.listEvents({ dealId: 17 })).find(e => e.event_type === 'shipment.writeoff');
    assert.equal(ev.status, 'failed');
    assert.equal(ev.retry_count, 1);
    assert.equal(hub.count('1c', 'createDocument'), 1, 'сбой IIKO не мешает реализации в 1С');

    await hub.pool.query(`UPDATE integration_queue SET next_attempt_at = now() WHERE id = $1`, [ev.id]);
    await hub.worker.drain();
    ev = (await hub.store.listEvents({ dealId: 17 })).find(e => e.event_type === 'shipment.writeoff');
    assert.equal(ev.status, 'processed');
    assert.equal(hub.count('iiko', 'createWriteoff'), 1);
    await hub.close();
});

test('ошибка в данных документа: сразу в необработанные, алерт и задача менеджеру, ручной повтор', async () => {
    const hub = await makeHub();
    hub.gw.deals.set(18, makeDeal(18));
    await hub.dealChanged(18);
    await hub.store.setProductMap(11, { onec_ref: null });
    await hub.cdekStatus(await uuidOf(hub, 18), 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    const ev = (await hub.store.listEvents({ dealId: 18 })).find(e => e.event_type === 'shipment.sale');
    assert.equal(ev.status, 'dead');
    assert.match(ev.error_message, /не сопоставлен с карточкой 1С/);
    assert.equal(hub.alerts.length, 1);
    assert.ok(hub.gw.calls.some(c => c.op === 'addTask' && /Нужна ручная проверка/.test(c.text)));
    assert.equal(hub.count('iiko', 'createWriteoff'), 1, 'списание при этом прошло');

    // Бухгалтер указал карточку, оператор нажал «Повторить» в панели
    await hub.store.setProductMap(11, { onec_ref: 'onec-11' });
    assert.equal(await hub.store.retryEvent(ev.id), true);
    await hub.worker.drain();
    assert.equal((await hub.store.getStockDoc('deal:18:sale')).status, 'done');
    assert.equal(hub.count('1c', 'createDocument'), 1);
    await hub.close();
});

test('выключенные IIKO и 1С: документы помечаются пропущенными, их можно создать позже', async () => {
    const hub = await makeHub({ IIKO_WRITEOFF_ENABLED: 'false', API_1C_ENABLED: 'false' });
    hub.gw.deals.set(19, makeDeal(19));
    await hub.dealChanged(19);
    await hub.cdekStatus(await uuidOf(hub, 19), 'RECEIVED_AT_SHIPMENT_WAREHOUSE');
    assert.deepEqual((await hub.store.listStockDocs(19)).map(d => d.status), ['skipped', 'skipped']);
    assert.equal(hub.count('iiko', 'createWriteoff'), 0);
    assert.equal(await hub.store.resetStockDoc('deal:19:writeoff'), true);
    assert.equal((await hub.store.getStockDoc('deal:19:writeoff')).status, 'pending');
    await hub.close();
});

test('очередь: зависшие события возвращаются, исчерпанные повторы уходят в необработанные', async () => {
    const hub = await makeHub();
    await hub.store.enqueue({ eventType: 'no.such.event', source: 'x', payload: {}, operationKey: 'bad-1', maxRetries: 2 });
    await hub.worker.drain();
    let [ev] = await hub.store.listEvents({});
    assert.equal(ev.status, 'failed');
    const next = (await hub.pool.query('SELECT next_attempt_at > now() AS later FROM integration_queue WHERE id = $1', [ev.id])).rows[0];
    assert.equal(next.later, true, 'повтор отложен');
    await hub.pool.query('UPDATE integration_queue SET next_attempt_at = now()');
    await hub.worker.drain();
    [ev] = await hub.store.listEvents({});
    assert.equal(ev.status, 'dead');

    await hub.store.enqueue({ eventType: 'test', source: 'x', payload: {}, operationKey: 'stuck-1' });
    await hub.pool.query(`UPDATE integration_queue SET status = 'processing', locked_at = now() - interval '1 hour' WHERE operation_key = 'stuck-1'`);
    assert.equal(await hub.store.releaseStuck(10), 1);
    await hub.worker.drain();
    assert.equal((await hub.store.listEvents({})).find(e => e.operation_key === 'stuck-1').status, 'processed');

    // Два воркера не забирают одно событие
    for (let i = 0; i < 6; i++) await hub.store.enqueue({ eventType: 'test', source: 'x', payload: {}, operationKey: `par-${i}` });
    const [a, b] = await Promise.all([hub.store.claim(4), hub.store.claim(4)]);
    const ids = [...a, ...b].map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 6);
    await hub.close();
});

test('воронка вне списка обслуживаемых игнорируется', async () => {
    const hub = await makeHub({ AMO_PIPELINE_IDS: '1' });
    hub.gw.deals.set(20, makeDeal(20, { pipeline_id: 99 }));
    await hub.dealChanged(20);
    assert.equal(hub.count('cdek', 'createOrder'), 0);
    assert.equal(await hub.store.getDeal(20), null);
    await hub.close();
});

test('остатки фулфилмента сохраняются в справочник', async () => {
    const hub = await makeHub();
    const payload = { external_id: '900', external_system: 'cdek_ff', product: { name: 'Relax Time', sku: 'RT-1', article: 'A1', stock: 14, price_minor: 500000, currency: 'KZT', warehouses: [{ warehouse: 1, count: 14 }] } };
    await hub.store.enqueue({ eventType: 'fulfillment.stock.updated', source: 'fulfillment', payload, operationKey: 'ff-1' });
    await hub.worker.drain();
    const row = (await hub.pool.query('SELECT * FROM ff_offers')).rows[0];
    assert.equal(row.sku, 'RT-1');
    assert.equal(Number(row.stock), 14);
    assert.equal((await hub.store.queueStats()).processed, 1);
    await hub.close();
});
