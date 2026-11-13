import { checkAdminInvoice, readAdminBilling } from '@/lib/server/billing';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { return noStoreJson(await readAdminBilling(request)); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { return noStoreJson(await checkAdminInvoice(request)); }
  catch (error) { return errorResponse(error); }
}
