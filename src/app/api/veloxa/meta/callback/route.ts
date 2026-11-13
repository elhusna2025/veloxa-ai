import { NextResponse } from 'next/server';
import { finishMetaOAuth, metaConfig } from '@/lib/server/meta-oauth';
import { errorResponse } from '@/lib/server/http';
import { verifyOAuthBrowserState, clearOAuthBrowserState } from '@/lib/server/oauth-browser-state';
import { ApiError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  let flow: 'meta' | 'meta_ads' = 'meta';
  const redirect = (origin: string, status: 'connected' | 'failed') => {
    const url = new URL('/', origin);
    url.searchParams.set(flow === 'meta_ads' ? 'metaAds' : 'meta', status);
    return clearOAuthBrowserState(NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), flow);
  };
  try {
    try { verifyOAuthBrowserState(request, 'meta'); }
    catch { verifyOAuthBrowserState(request, 'meta_ads'); flow = 'meta_ads'; }
    const result = await finishMetaOAuth(new URL(request.url), {}, flow === 'meta_ads' ? 'ads' : 'organic');
    return redirect(result.origin, 'connected');
  } catch (error) {
    console.warn('veloxa_meta_callback_failed', { code: error instanceof ApiError ? error.code : 'invalid_callback' });
    try { return redirect(metaConfig().origin, 'failed'); }
    catch { return clearOAuthBrowserState(errorResponse(error), flow); }
  }
}
