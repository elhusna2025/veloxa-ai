import { NextResponse } from 'next/server';
import { finishMetaOAuth, metaConfig } from '@/lib/server/meta-oauth';
import { errorResponse } from '@/lib/server/http';
import { verifyOAuthBrowserState, clearOAuthBrowserState } from '@/lib/server/oauth-browser-state';
import { ApiError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    verifyOAuthBrowserState(request, 'meta');
    const result = await finishMetaOAuth(new URL(request.url));
    return clearOAuthBrowserState(NextResponse.redirect(new URL('/?meta=connected', result.origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), 'meta');
  } catch (error) {
    console.warn('veloxa_meta_callback_failed', { code: error instanceof ApiError ? error.code : 'invalid_callback' });
    try { return clearOAuthBrowserState(NextResponse.redirect(new URL('/?meta=failed', metaConfig().origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), 'meta'); }
    catch { return clearOAuthBrowserState(errorResponse(error), 'meta'); }
  }
}
