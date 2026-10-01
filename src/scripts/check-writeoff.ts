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

  console.log(`🔍 Проверка списаний за последний час для ${orgId}`);

  const writeoffs = await iiko.checkOrderWriteoff(orgId, 1);

  console.log(`\n✅ Найдено ${writeoffs.length} списаний за последний час:`);
  for (const w of writeoffs) {
    console.log(`\n📄 #${w.number} от ${w.date}`);
    console.log(`   Статус: ${w.status}`);
    console.log(`   Склад:  ${w.storeFrom}`);
    console.log(`   Позиций: ${w.items?.length ?? 'нет данных'}`);
  }
}

main().catch(err => {
  console.error('💥 Ошибка:', err.response?.data || err.message);
  process.exit(1);
});
