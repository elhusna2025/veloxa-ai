import { getAdminIntegrations } from '@/lib/server/admin-integrations';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try { return noStoreJson(await getAdminIntegrations(request)); }
  catch (error) { return errorResponse(error); }
}
