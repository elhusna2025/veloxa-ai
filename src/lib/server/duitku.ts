import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './http';

const referenceSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const merchantOrderIdSchema = z.string().regex(/^vlx_[0-9a-f]{32}$/);

export type DuitkuConfig = {
  mode: 'sandbox' | 'production';
  merchantCode: string;
  key: string;
  origin: string;
};

export function duitkuConfig(env: Record<string, string | undefined> = process.env): DuitkuConfig | null {
  const mode = env.VELOXA_DUITKU_MODE;
  const merchantCode = env.DUITKU_MERCHANT_CODE?.trim();
  const key = env.DUITKU_API_KEY?.trim();
  const publicUrl = env.VELOXA_BILLING_ORIGIN;
  if ((mode !== 'sandbox' && mode !== 'production') || !merchantCode || !/^[A-Za-z0-9]{1,50}$/.test(merchantCode) || !key || !publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return { mode, merchantCode, key, origin: url.origin };
  } catch { return null; }
}

const signature = (key: string, message: string) => createHmac('sha256', key).update(message).digest('hex');
const unavailable = () => new ApiError(502, 'Hasil permintaan ke Duitku belum dapat dipastikan. Periksa status tagihan sebelum membuat tagihan baru.', 'payment_provider_unavailable');
const appHost = (mode: DuitkuConfig['mode']) => mode === 'production' ? 'app-prod.duitku.com' : 'app-sandbox.duitku.com';

export function duitkuPaymentUrl(value: unknown, mode: DuitkuConfig['mode'], reference: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== appHost(mode) || url.port || url.username || url.password ||
      url.pathname !== '/redirect_checkout' || url.searchParams.getAll('reference').length !== 1 || url.searchParams.get('reference') !== reference) return null;
    return `https://${appHost(mode)}/redirect_checkout?reference=${encodeURIComponent(reference)}&lang=id`;
  } catch { return null; }
}

async function duitkuRequest(url: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, { ...init, method: 'POST', signal: AbortSignal.timeout(12_000), cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw unavailable();
    return await response.json();
  } catch { throw unavailable(); }
}

export async function createDuitkuInvoice(config: DuitkuConfig, input: {
  id: string; amountIdr: number; planName: string; email: string; now: number; expiryMinutes: number;
}, fetcher = fetch) {
  const host = config.mode === 'production' ? 'api-prod.duitku.com' : 'api-sandbox.duitku.com';
  const timestamp = String(input.now);
  const data = await duitkuRequest(`https://${host}/api/merchant/createInvoice`, {
    headers: { 'Content-Type': 'application/json', 'x-duitku-merchantcode': config.merchantCode,
      'x-duitku-timestamp': timestamp, 'x-duitku-signature': signature(config.key, config.merchantCode + timestamp) },
    body: JSON.stringify({
      paymentAmount: input.amountIdr, merchantOrderId: input.id, productDetails: input.planName,
      email: input.email, expiryPeriod: input.expiryMinutes,
      itemDetails: [{ name: input.planName, price: input.amountIdr, quantity: 1 }],
      callbackUrl: `${config.origin}/api/veloxa/billing-webhook/`,
      returnUrl: `${config.origin}/?billing=return`,
    }),
  }, fetcher);
  const result = z.object({ merchantCode: z.literal(config.merchantCode), reference: referenceSchema, paymentUrl: z.string(), statusCode: z.literal('00') }).safeParse(data);
  if (!result.success) throw unavailable();
  const paymentUrl = duitkuPaymentUrl(result.data.paymentUrl, config.mode, result.data.reference);
  if (!paymentUrl) throw unavailable();
  return { reference: result.data.reference, paymentUrl };
}

const amountSchema = z.union([z.string().regex(/^\d{1,12}(?:\.0{1,2})?$/).transform(Number), z.number()]).pipe(z.number().int().positive().safe());

export async function checkDuitkuInvoice(config: DuitkuConfig, id: string, fetcher = fetch) {
  const host = config.mode === 'production' ? 'passport.duitku.com' : 'sandbox.duitku.com';
  const data = await duitkuRequest(`https://${host}/webapi/api/merchant/transactionStatus`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantCode: config.merchantCode, merchantOrderId: id, signature: signature(config.key, config.merchantCode + id) }),
  }, fetcher);
  const result = z.object({ merchantOrderId: z.literal(id), reference: referenceSchema, amount: amountSchema, statusCode: z.enum(['00', '01', '02']) }).safeParse(data);
  if (!result.success) throw unavailable();
  return result.data;
}

export async function parseDuitkuCallback(request: Request, config: DuitkuConfig) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new ApiError(415, 'Format pemberitahuan pembayaran tidak valid.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Pemberitahuan pembayaran kosong.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new ApiError(413, 'Pemberitahuan pembayaran terlalu besar.'); }
    chunks.push(value);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const keys = ['merchantCode', 'merchantOrderId', 'amount', 'reference', 'signature'] as const;
  if (keys.some(key => params.getAll(key).length !== 1)) throw new ApiError(400, 'Data pemberitahuan pembayaran tidak lengkap.');
  const result = z.object({ merchantCode: z.literal(config.merchantCode), merchantOrderId: merchantOrderIdSchema,
    amount: z.string(), reference: referenceSchema, signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).parse(Object.fromEntries(keys.map(key => [key, params.get(key)])));
  const expected = signature(config.key, result.merchantCode + result.amount + result.merchantOrderId);
  if (!timingSafeEqual(Buffer.from(result.signature, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new ApiError(403, 'Tanda tangan pembayaran tidak valid.');
  }
  return { id: result.merchantOrderId, amount: amountSchema.parse(result.amount), reference: result.reference };
}
