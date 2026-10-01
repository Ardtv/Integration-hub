import { IikoService } from '../services/iiko.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const iiko = new IikoService(
    process.env.IIKO_API_KEY!,
    process.env.IIKO_APP_ID!,
    process.env.IIKO_CLIENT_SECRET!
  );
  try {
    const accounts = await iiko.request(
      'POST',
      '/api/inventory/v1/chart-of-accounts/list',
      {}
    );
    console.log(JSON.stringify(accounts, null, 2));
  } catch (err: any) {
    console.error('❌', err.response?.status, err.response?.data || err.message);
  }
}

main();
