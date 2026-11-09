import { beginInstagramOAuth } from '@/lib/server/instagram-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { attachOAuthBrowserState } from '@/lib/server/oauth-browser-state';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const result = await beginInstagramOAuth(request, (await readJson(request)).workspaceId); return attachOAuthBrowserState(noStoreJson({ ok: true, ...result }), result.url, 'instagram'); }
  catch (error) { return errorResponse(error); }
}
