import { IikoService } from '../services/iiko.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const apiKey = process.env.IIKO_API_KEY;
  const appId = process.env.IIKO_APP_ID;
  const clientSecret = process.env.IIKO_CLIENT_SECRET;
  const organizationId = process.env.IIKO_ORGANIZATION_ID;

  if (!apiKey || !appId || !clientSecret) {
    console.error('❌ Не заданы IIKO_API_KEY, IIKO_APP_ID или IIKO_CLIENT_SECRET');
    process.exit(1);
  }

  const iiko = new IikoService(apiKey, appId, clientSecret);

  // 1. Авторизация
  console.log('\n=== 1. АВТОРИЗАЦИЯ (v2) ===');
  try {
    const token = await iiko.getToken();
    console.log(`✅ Токен получен: ${token.substring(0, 30)}...`);
  } catch (err: any) {
    console.error('❌ Ошибка:', err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }

  // 2. Организации
  console.log('\n=== 2. ОРГАНИЗАЦИИ ===');
  try {
    const orgs = await iiko.getOrganizations();
    console.log('✅ Организации:', JSON.stringify(orgs, null, 2).substring(0, 1500));
    console.log('\n⚠️  Скопируйте ID организации в .env как IIKO_ORGANIZATION_ID');
  } catch (err: any) {
    console.error('❌ Ошибка:', err.response?.status, err.response?.data || err.message);
  }

  // 3. Остатки
  console.log('\n=== 3. ОСТАТКИ (stock_balance/list) ===');
  if (organizationId) {
    try {
      const now = new Date().toISOString();
      const balances = await iiko.getStockBalance(organizationId, now);
      console.log('✅ Ответ:', JSON.stringify(balances, null, 2).substring(0, 1500));
    } catch (err: any) {
      console.error('❌ Ошибка:', err.response?.status, err.response?.data || err.message);
    }
  } else {
    console.log('⚠️ IIKO_ORGANIZATION_ID не задан — пропускаю');
  }

  // 4. Списания
  console.log('\n=== 4. СПИСАНИЯ (writeoff_document/list) ===');
  if (organizationId) {
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const writeoffs = await iiko.getWriteoffDocuments(organizationId, from, to);
      console.log(`✅ Найдено: ${Array.isArray(writeoffs) ? writeoffs.length : 0} списаний`);
    } catch (err: any) {
      console.error('❌ Ошибка:', err.response?.status, err.response?.data || err.message);
    }
  } else {
    console.log('⚠️ IIKO_ORGANIZATION_ID не задан — пропускаю');
  }
}

main().catch(err => {
  console.error('💥 Фатальная ошибка:', err);
  process.exit(1);
});
