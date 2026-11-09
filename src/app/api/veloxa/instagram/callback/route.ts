import { NextResponse } from 'next/server';
import { finishInstagramOAuth } from '@/lib/server/instagram-oauth';
import { instagramLoginConfig } from '@/lib/server/instagram-config';
import { errorResponse } from '@/lib/server/http';
import { verifyOAuthBrowserState, clearOAuthBrowserState } from '@/lib/server/oauth-browser-state';
import { ApiError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    verifyOAuthBrowserState(request, 'instagram');
    const result = await finishInstagramOAuth(new URL(request.url));
    return clearOAuthBrowserState(NextResponse.redirect(new URL('/?instagram=authorized', result.origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), 'instagram');
  } catch (error) {
    console.warn('veloxa_instagram_callback_failed', { code: error instanceof ApiError ? error.code : 'invalid_callback' });
    try { return clearOAuthBrowserState(NextResponse.redirect(new URL('/?instagram=failed', instagramLoginConfig().origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }), 'instagram'); }
    catch { return clearOAuthBrowserState(errorResponse(error), 'instagram'); }
  }
}
