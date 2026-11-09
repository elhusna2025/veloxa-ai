import { beginMetaOAuth } from '@/lib/server/meta-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { attachOAuthBrowserState } from '@/lib/server/oauth-browser-state';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const result = await beginMetaOAuth(request, (await readJson(request)).workspaceId); return attachOAuthBrowserState(noStoreJson({ ok: true, ...result }), result.url, 'meta'); }
  catch (error) { return errorResponse(error); }
}
