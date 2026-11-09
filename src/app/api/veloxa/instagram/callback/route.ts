import { NextResponse } from 'next/server';
import { finishInstagramOAuth } from '@/lib/server/instagram-oauth';
import { instagramLoginConfig } from '@/lib/server/instagram-config';
import { errorResponse } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const result = await finishInstagramOAuth(new URL(request.url));
    return NextResponse.redirect(new URL('/?instagram=authorized', result.origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    try { return NextResponse.redirect(new URL('/?instagram=failed', instagramLoginConfig().origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
    catch { return errorResponse(error); }
  }
}
