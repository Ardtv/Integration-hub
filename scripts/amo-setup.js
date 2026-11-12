#!/usr/bin/env node
// Создаёт в amoCRM поля и этапы Этапа 2.1 и печатает строки для .env.
// ВНИМАНИЕ: меняет боевую воронку. По умолчанию только показывает план.
//   node scripts/amo-setup.js --pipeline <id>            показать, что будет создано
//   node scripts/amo-setup.js --pipeline <id> --apply    создать
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const AmoClient = require('../connectors/amo/amo-client');

const FIELDS = [
    { env: 'AMO_FIELD_METHOD', name: 'Способ отправки', type: 'select', enums: ['СДЭК', 'Караганда (B2B)'] },
    { env: 'AMO_FIELD_COUNTRY', name: 'Страна', type: 'select', enums: ['Казахстан', 'Россия'] },
    { env: 'AMO_FIELD_DELIVERY_TYPE', name: 'Тип доставки', type: 'select', enums: ['До двери', 'ПВЗ'] },
    { env: 'AMO_FIELD_CITY', name: 'Город', type: 'text' },
    { env: 'AMO_FIELD_ADDRESS', name: 'Адрес', type: 'text' },
    { env: 'AMO_FIELD_PVZ', name: 'Код ПВЗ', type: 'text' },
    { env: 'AMO_FIELD_TRACK', name: 'Трек СДЭК', type: 'text' }
];
const STAGES = [
    { env: 'AMO_STAGE_SEND', name: 'Передать в доставку', color: '#fffeb2' },
    { env: 'AMO_STAGE_CREATED', name: 'Заказ создан', color: '#98cbff' },
    { env: 'AMO_STAGE_DELIVERED', name: 'Доставлено', color: '#87f2c0' },
    { env: 'AMO_STAGE_ERROR', name: 'Ошибка оформления', color: '#ff8f92' }
];

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

(async () => {
    const apply = process.argv.includes('--apply');
    const pipelineId = Number(arg('--pipeline'));
    const amo = new AmoClient(process.env.AMO_API_TOKEN, process.env.AMO_API_DOMAIN);
    const pipelines = await amo.listPipelines();
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (!pipeline) {
        console.error('Укажите воронку: --pipeline <id>. Доступные:');
        for (const p of pipelines) console.error(`  ${p.id}  ${p.name}`);
        process.exit(1);
    }

    const env = [`AMO_PIPELINE_IDS=${pipeline.id}`];
    const existingFields = await amo.listLeadFields();
    const toCreateFields = [];
    for (const f of FIELDS) {
        const found = existingFields.find(x => same(x.name, f.name));
        if (found) env.push(`${f.env}=${found.id}`);
        else toCreateFields.push(f);
    }
    const existingStages = pipeline._embedded?.statuses || [];
    const toCreateStages = [];
    for (const s of STAGES) {
        const found = existingStages.find(x => same(x.name, s.name));
        if (found) env.push(`${s.env}=${found.id}`);
        else toCreateStages.push(s);
    }

    console.log(`Воронка: «${pipeline.name}» (${pipeline.id})`);
    console.log(`Будут созданы поля: ${toCreateFields.map(f => f.name).join(', ') || 'нет, все уже есть'}`);
    console.log(`Будут созданы этапы: ${toCreateStages.map(s => s.name).join(', ') || 'нет, все уже есть'}`);

    if (!apply) {
        console.log('\nЭто предварительный просмотр. Для создания добавьте --apply.');
    } else {
        if (toCreateFields.length) {
            const created = await amo.createLeadFields(toCreateFields.map(f => ({
                name: f.name, type: f.type, ...(f.enums ? { enums: f.enums.map((value, i) => ({ value, sort: (i + 1) * 10 })) } : {})
            })));
            for (const f of toCreateFields) {
                const c = created.find(x => same(x.name, f.name));
                if (c) env.push(`${f.env}=${c.id}`); else console.error(`Поле «${f.name}» не создано`);
            }
        }
        if (toCreateStages.length) {
            const maxSort = Math.max(0, ...existingStages.filter(s => s.type !== 1 && ![142, 143].includes(s.id)).map(s => s.sort || 0));
            const created = await amo.createStatuses(pipeline.id, toCreateStages.map((s, i) => ({ name: s.name, color: s.color, sort: maxSort + (i + 1) * 10 })));
            for (const s of toCreateStages) {
                const c = created.find(x => same(x.name, s.name));
                if (c) env.push(`${s.env}=${c.id}`); else console.error(`Этап «${s.name}» не создан`);
            }
        }
        console.log('\nГотово. Порядок этапов в воронке поправьте мышкой в интерфейсе amo.');
    }
    console.log('\nСтроки для .env (уже существующее' + (apply ? ' и созданное' : '') + '):\n');
    console.log(env.join('\n'));
})().catch(e => { console.error(e.message); process.exit(1); });
