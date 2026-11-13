import { confirmDuitkuPayment } from '@/lib/server/billing';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try { return noStoreJson(await confirmDuitkuPayment(request)); }
  catch (error) { return errorResponse(error); }
}
