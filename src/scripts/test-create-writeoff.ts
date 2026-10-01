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
  const expenseAccountId = '02b66f01-1643-41eb-93af-5f000640d853';
  const storeId = '07ce2f59-445f-4693-8d23-647fa1df06d8';
  const productId = '0f5586e3-a820-4072-8ae4-e88e123cf124';
  const amountUnitId = 'cd19b5ea-1b32-a6e5-1df7-5d2784a0549a';

  console.log('📝 Создаю тестовое списание...');

  try {
    const result = await iiko.request(
      'POST',
      '/api/inventory/v1/writeoff_document/create',
      {
        organizationId: orgId,
        date: new Date().toISOString(),
        storeFrom: storeId,
        expenseAccount: expenseAccountId,
        isAutomatic: false,
        isEditable: true,
        comment: 'Тестовое списание из интеграции',
        items: [
          {
            num: 1,
            product: productId,
            amount: 1,
            amountUnit: amountUnitId
          }
        ]
      }
    );
    console.log('✅ Списание создано:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('❌ Ошибка:', err.response?.status);
    console.error(JSON.stringify(err.response?.data, null, 2));
  }
}

main();
