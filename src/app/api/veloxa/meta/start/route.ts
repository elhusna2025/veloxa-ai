import { beginMetaOAuth } from '@/lib/server/meta-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { attachOAuthBrowserState } from '@/lib/server/oauth-browser-state';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const purpose = z.enum(['organic', 'ads']).optional().parse(body.purpose) ?? 'organic';
    const result = await beginMetaOAuth(request, body.workspaceId, {}, purpose);
    return attachOAuthBrowserState(noStoreJson({ ok: true, ...result }), result.url, purpose === 'ads' ? 'meta_ads' : 'meta');
  }
  catch (error) { return errorResponse(error); }
}
