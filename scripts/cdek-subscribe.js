#!/usr/bin/env node
// Подписывает хаб на вебхуки статусов СДЭК.
//   node scripts/cdek-subscribe.js https://домен/webhook/cdek?secret=...
//   node scripts/cdek-subscribe.js --list
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const CdekClient = require('../connectors/cdek/cdek-client');

(async () => {
    const arg = process.argv[2];
    if (arg === '--list') { console.log(JSON.stringify(await CdekClient.listWebhooks(), null, 2)); return; }
    if (!arg || !/^https:\/\//.test(arg)) { console.error('Укажите https-адрес вебхука или --list'); process.exit(1); }
    console.log(JSON.stringify(await CdekClient.subscribeWebhook(arg), null, 2));
})().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
