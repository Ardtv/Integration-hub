import { IikoService } from '../services/iiko.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const iiko = new IikoService(
    process.env.IIKO_API_KEY!,
    process.env.IIKO_APP_ID!,
    process.env.IIKO_CLIENT_SECRET!
  );

  const orgId = process.env.IIKO_ORGANIZATION_ID!;

  // За год
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  console.log(`📝 Ищу списания с ${from} по ${to}...`);
  try {
    const writeoffs = await iiko.getWriteoffDocuments(orgId, from, to);
    console.log(`✅ Найдено: ${writeoffs.length} списаний`);

    if (writeoffs.length > 0) {
      console.log('\n📋 Первые 5 списаний:');
      for (const w of writeoffs.slice(0, 5)) {
        console.log(`\n#${w.number} от ${w.date}`);
        console.log(`  documentId:    ${w.documentId}`);
        console.log(`  status:        ${w.status}`);
        console.log(`  storeFrom:     ${w.storeFrom}`);
        console.log(`  expenseAccount: ${w.expenseAccount}`);
        console.log(`  items:         ${JSON.stringify(w.items).substring(0, 200)}`);
      }
      console.log('\n💡 Скопируйте expenseAccount из любого списания');
    } else {
      console.log('⚠️ Списаний нет. Используйте Вариант B.');
    }
  } catch (err: any) {
    console.error('❌', err.response?.status, err.response?.data || err.message);
  }
}

main();
