import { ApiError } from './http';

export type MetaChannel = 'facebook' | 'instagram';
export interface MetaConnection {
  channel: MetaChannel;
  accountId: string;
  pageId: string;
  accountName: string;
  handle: string;
  encryptedToken: string;
  expiresAt: number;
  lastPublishedAt?: string;
}

export class MetaRequestError extends ApiError {
  constructor(message: string, public uncertain = false, public providerCode?: number) { super(502, message, uncertain ? 'delivery_unknown' : 'meta_rejected'); }
}

export function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION || process.env.META_INSTAGRAM_API_VERSION || 'v26.0';
  if (!/^v\d+\.0$/.test(version)) throw new ApiError(503, 'Versi Meta API belum valid.', 'meta_not_configured');
  return version;
}

export async function graphRequest<T>(path: string, token: string, method: 'GET' | 'POST' = 'GET', values: Record<string, string> | FormData = {}, fetcher: typeof fetch = fetch): Promise<T> {
  if (!/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/.test(path)) throw new ApiError(400, 'Alamat operasi Meta tidak valid.');
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  if (method === 'GET') for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' && !(values instanceof FormData) ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: values instanceof FormData ? values : new URLSearchParams(values) } : {}),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
  } catch { throw new MetaRequestError('Hasil permintaan Meta belum dapat dipastikan. Periksa akun sebelum mencoba ulang.', method === 'POST'); }
  let data: T & { error?: { code?: number } };
  try { data = await response.json(); } catch { throw new MetaRequestError('Respons Meta tidak dapat dipastikan. Periksa akun Anda.', method === 'POST'); }
  if (!data || typeof data !== 'object') throw new MetaRequestError('Respons Meta tidak valid. Periksa akun Anda.', method === 'POST');
  if (!response.ok || data.error) {
    const code = data.error?.code;
    throw new MetaRequestError(code === 190 ? 'Izin Meta berakhir. Hubungkan ulang akun Anda.' : code === 10 || code === 200 ? 'Izin publikasi Meta belum diberikan. Hubungkan ulang dengan izin yang diperlukan.' : 'Meta menolak permintaan. Periksa izin akun, media, dan batas publikasi.', method === 'POST' && response.status >= 500, code);
  }
  return data;
}

export async function publishMetaImage(params: { channel: MetaChannel; accountId: string; token: string; imageUrl: string; imageBytes?: Buffer; caption: string }, deps: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ externalPostId: string; permalink?: string }> {
  if (!/^\d+$/.test(params.accountId)) throw new ApiError(409, 'ID akun Meta tidak valid. Hubungkan ulang akun.');
  if (!params.token.trim()) throw new ApiError(409, 'Izin Meta tidak tersedia. Hubungkan ulang akun.');
  const request = <T>(path: string, method: 'GET' | 'POST', values: Record<string, string>) => graphRequest<T>(path, params.token, method, values, deps.fetcher);
  if (params.channel === 'facebook') {
    // Follow Cendekia's proven binary upload path: do not depend on Facebook's URL crawler.
    if (!params.imageBytes || params.imageBytes.length > 8 * 1024 * 1024) throw new ApiError(400, 'Gambar JPEG Facebook belum tersedia atau terlalu besar.');
    const form = new FormData();
    form.set('source', new Blob([new Uint8Array(params.imageBytes)], { type: 'image/jpeg' }), 'veloxa.jpg');
    form.set('caption', params.caption);
    form.set('published', 'true');
    const data = await graphRequest<{ id?: string; post_id?: string }>(`${params.accountId}/photos`, params.token, 'POST', form, deps.fetcher);
    const id = data.post_id || data.id;
    if (!id) throw new MetaRequestError('Meta tidak mengembalikan ID posting. Periksa Page sebelum mencoba ulang.', true);
    return { externalPostId: id, permalink: `https://www.facebook.com/${id}` };
  }
  let container: { id?: string };
  try { container = await request<{ id?: string }>(`${params.accountId}/media`, 'POST', { image_url: params.imageUrl, caption: params.caption }); }
  catch (error) {
    if (error instanceof MetaRequestError) throw new MetaRequestError(error.message, false, error.providerCode);
    throw error;
  }
  if (!container.id || !/^\d+$/.test(container.id)) throw new MetaRequestError('Instagram belum menghasilkan kontainer media.');
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let finished = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const state = await request<{ status_code?: string }>(container.id, 'GET', { fields: 'status_code' });
    if (state.status_code === 'FINISHED') { finished = true; break; }
    if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new MetaRequestError('Instagram gagal memproses gambar. Periksa format dan akses media.');
    await sleep(1500);
  }
  if (!finished) throw new MetaRequestError('Instagram masih memproses gambar. Belum ada posting diterbitkan.');
  const published = await request<{ id?: string }>(`${params.accountId}/media_publish`, 'POST', { creation_id: container.id });
  if (!published.id) throw new MetaRequestError('Hasil publikasi Instagram belum dapat dipastikan.', true);
  let permalink: string | undefined;
  try { permalink = (await request<{ permalink?: string }>(published.id, 'GET', { fields: 'permalink' })).permalink; } catch { /* The confirmed remote ID remains a successful receipt. */ }
  return { externalPostId: published.id, permalink };
}
