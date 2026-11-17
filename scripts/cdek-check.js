#!/usr/bin/env node
// Проверка ключей СДЭК без записи: вход, коды городов, тарифы по договору.
//   node scripts/cdek-check.js [Откуда] [Куда]     по умолчанию Астана → Алматы
// Если в окружении остались старые переменные: env -i PATH="$PATH" HOME="$HOME" node scripts/cdek-check.js
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
const ax = require('axios');
const B = process.env.CDEK_API_BASE;
const [from = 'Астана', to = 'Алматы'] = process.argv.slice(2);
(async () => {
    const t = (await ax.post(B + '/oauth/token', new URLSearchParams({
        grant_type: 'client_credentials', client_id: process.env.CDEK_CLIENT_ID, client_secret: process.env.CDEK_CLIENT_SECRET
    }))).data.access_token;
    console.log(`Авторизация СДЭК (${B}): OK`);
    const h = { headers: { Authorization: 'Bearer ' + t } };
    const code = async n => (await ax.get(B + '/location/cities?country_codes=KZ,RU&city=' + encodeURIComponent(n), h)).data[0]?.code;
    const a = await code(from), b = await code(to);
    console.log(`Коды городов: ${from} ${a}, ${to} ${b}`);
    const r = await ax.post(B + '/calculator/tarifflist', { from_location: { code: a }, to_location: { code: b }, packages: [{ weight: 500 }] }, h);
    for (const x of r.data.tariff_codes || []) console.log(x.tariff_code, x.tariff_name, '| режим', x.delivery_mode, '|', x.delivery_sum);
})().catch(e => { console.error('Ошибка:', e.response?.status, JSON.stringify(e.response?.data || e.message)); process.exit(1); });
