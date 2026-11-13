import { errorResponse, noStoreJson } from '@/lib/server/http';
import { getMetaAds, mutateMetaAds } from '@/lib/server/meta-ads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(request: Request) {
  try { return noStoreJson(await getMetaAds(request)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return noStoreJson(await mutateMetaAds(request)); }
  catch (error) { return errorResponse(error); }
}
