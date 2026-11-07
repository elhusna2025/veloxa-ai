import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'request_failed') { super(message); }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ ok: false, error: 'Data permintaan tidak valid.', code: 'invalid_request' }, { status: 400 });
  // Never return provider responses, access tokens, or infrastructure credentials to the browser.
  return NextResponse.json({ ok: false, error: 'Layanan belum dapat menyelesaikan permintaan. Periksa konfigurasi server atau coba lagi.', code: 'service_unavailable' }, { status: 503 });
}

export function noStoreJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function readJson(request: Request, maxBytes = 64 * 1024) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new ApiError(413, 'Data permintaan terlalu besar.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Data permintaan kosong.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'Data permintaan terlalu besar.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
