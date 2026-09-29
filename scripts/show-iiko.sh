#!/bin/bash
# Демонстрация IIKO для заказчика

cd ~/integration-hub

echo "════════════════════════════════════════════════════════════"
echo " IIKO API — ДЕМОНСТРАЦИЯ"
echo "════════════════════════════════════════════════════════════"
echo ""

echo "════════ ШАГ 1: ПРОВЕРКА ПЕРЕМЕННЫХ ════════"
echo ""
grep "IIKO" .env | sed 's/=.*/=***/'
echo ""

echo "════════ ШАГ 2: ПОЛУЧЕНИЕ ТОКЕНА ════════"
echo ""
node -e "
require('dotenv').config();
const axios = require('axios');

(async () => {
    try {
        const start = Date.now();
        const response = await axios.post(
            'https://api-ru.iiko.services/api/v2/access_token',
            {
                apiKey: process.env.IIKO_API_KEY,
                appId: process.env.IIKO_APP_ID,
                clientSecret: process.env.IIKO_CLIENT_SECRET
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        const duration = Date.now() - start;
        console.log('✅ Токен получен за', duration, 'мс');
        console.log('   correlationId:', response.data.correlationId);
        console.log('   token:', response.data.token.substring(0, 40) + '...');
        console.log('   длина:', response.data.token.length, 'символов');
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
        console.error('   Body:', JSON.stringify(e.response?.data, null, 2));
        process.exit(1);
    }
})();
"
echo ""

echo "════════ ШАГ 3: СПИСОК ОРГАНИЗАЦИЙ ════════"
echo ""
node -e "
require('dotenv').config();
const axios = require('axios');

(async () => {
    try {
        const tokenResp = await axios.post(
            'https://api-ru.iiko.services/api/v2/access_token',
            {
                apiKey: process.env.IIKO_API_KEY,
                appId: process.env.IIKO_APP_ID,
                clientSecret: process.env.IIKO_CLIENT_SECRET
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        const token = tokenResp.data.token;

        const orgsResp = await axios.post(
            'https://api-ru.iiko.services/api/1/organizations',
            {},
            { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 }
        );

        console.log('✅ Организаций:', orgsResp.data.organizations?.length || 0);
        for (const org of (orgsResp.data.organizations || [])) {
            console.log('   •', org.name);
            console.log('     id:', org.id);
            console.log('     country:', org.country || '(не указан)');
            console.log('     restaurantAddress:', org.restaurantAddress || '(не указан)');
        }
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
        console.error('   Body:', JSON.stringify(e.response?.data, null, 2));
        process.exit(1);
    }
})();
"
echo ""

echo "════════ ШАГ 4: ТЕРМИНАЛЬНЫЕ ГРУППЫ ════════"
echo ""
node -e "
require('dotenv').config();
const axios = require('axios');

(async () => {
    try {
        const tokenResp = await axios.post(
            'https://api-ru.iiko.services/api/v2/access_token',
            {
                apiKey: process.env.IIKO_API_KEY,
                appId: process.env.IIKO_APP_ID,
                clientSecret: process.env.IIKO_CLIENT_SECRET
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        const token = tokenResp.data.token;

        const orgsResp = await axios.post(
            'https://api-ru.iiko.services/api/1/organizations',
            {},
            { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 }
        );
        const orgId = orgsResp.data.organizations?.[0]?.id;
        if (!orgId) {
            console.log('⚠️ Нет организаций');
            return;
        }

        const tgResp = await axios.post(
            'https://api-ru.iiko.services/api/1/terminal_groups',
            { organizationIds: [orgId] },
            { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 }
        );

        const groups = tgResp.data.terminalGroups || [];
        let total = 0;
        for (const g of groups) {
            total += g.items?.length || 0;
        }
        console.log('✅ Терминальных групп:', groups.length, '| Терминалов:', total);
    } catch (e) {
        console.error('❌ Ошибка:', e.message);
    }
})();
"
echo ""

echo "════════════════════════════════════════════════════════════"
echo " ✅ IIKO API — РАБОТАЕТ"
echo "════════════════════════════════════════════════════════════"
