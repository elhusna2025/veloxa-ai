import { getAdminIncidents, updateAdminIncident } from '@/lib/server/admin-incidents';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  const response = errorResponse(error);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  try { return noStoreJson(await getAdminIncidents(request)); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try { return noStoreJson(await updateAdminIncident(request)); }
  catch (error) { return failure(error); }
}
