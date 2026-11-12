import { getAdminSettings, updateAdminSettings } from '@/lib/server/admin-settings';
import { errorResponse, noStoreJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminError(error: unknown) {
  const response = errorResponse(error);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  try { return noStoreJson(await getAdminSettings(request)); }
  catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  try { return noStoreJson(await updateAdminSettings(request)); }
  catch (error) { return adminError(error); }
}
