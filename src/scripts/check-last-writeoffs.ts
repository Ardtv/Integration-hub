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
  const today = new Date().toISOString().slice(0, 10);

  const writeoffs = await iiko.getWriteoffDocuments(orgId, today, today);
  console.log(`\n📋 Списаний за сегодня (${today}): ${writeoffs.length}`);
  for (const w of writeoffs) {
    console.log(`  #${w.number} | id: ${w.documentId} | date: ${w.date}`);
  }

  const target = writeoffs.find(w => w.documentId === 'cab2d1e1-e163-4dc2-bc4d-6f87ef14dd38');
  if (target) {
    console.log('\n✅ Наше тестовое списание найдено:');
    console.log(JSON.stringify(target, null, 2));
  } else {
    console.log('\n⚠️ Тестовое списание не найдено в списке');
  }
}

main();
