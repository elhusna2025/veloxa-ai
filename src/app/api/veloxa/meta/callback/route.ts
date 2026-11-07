import { NextResponse } from 'next/server';
import { finishMetaOAuth, metaConfig } from '@/lib/server/meta-oauth';
import { errorResponse } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const result = await finishMetaOAuth(new URL(request.url));
    return NextResponse.redirect(new URL('/?meta=connected', result.origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    try { return NextResponse.redirect(new URL('/?meta=failed', metaConfig().origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
    catch { return errorResponse(error); }
  }
}
