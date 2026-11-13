import { z } from 'zod';
import { ApiError } from './http';
import { graphRequest, MetaRequestError } from './meta-graph';

export const metaNumericId = z.string().regex(/^\d{1,32}$/);
type Row = Record<string, unknown>;
type Edge = { data?: Row[]; paging?: { next?: string; cursors?: { after?: string } } };

export function marketingGraph(token: string, fetcher?: typeof fetch) {
  const get = <T>(path: string, params: Record<string, string> = {}) => graphRequest<T>(path, token, 'GET', params, fetcher);
  const post = <T>(path: string, params: Record<string, string> | FormData) => graphRequest<T>(path, token, 'POST', params, fetcher);

  async function list(path: string, params: Record<string, string>, maxPages = 4) {
    const rows: Row[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const result: Edge = await get(path, { limit: '100', ...params, ...(cursor && { after: cursor }) });
      if (!Array.isArray(result.data)) throw new ApiError(502, 'Daftar Meta Ads belum dapat diverifikasi.', 'meta_ads_unverified');
      rows.push(...result.data);
      if (!result.paging?.next) return rows;
      const next: string | undefined = result.paging.cursors?.after;
      if (!next || next === cursor || next.length > 2000) break;
      cursor = next;
    }
    throw new ApiError(502, 'Daftar Meta Ads belum lengkap. Periksa kembali akses akun di Meta.', 'meta_ads_unverified');
  }

  async function create(path: string, params: Record<string, string>) {
    const result = await post<{ id?: string }>(path, params);
    const id = metaNumericId.safeParse(result.id);
    if (!id.success) throw new MetaRequestError('ID dari Meta belum dapat dikonfirmasi.', true);
    return id.data;
  }

  async function status(id: string, value: 'ACTIVE' | 'PAUSED') {
    const result = await post<{ success?: boolean }>(metaNumericId.parse(id), { status: value });
    if (result.success !== true) throw new MetaRequestError('Status kampanye dari Meta belum dapat dikonfirmasi.', true);
  }

  async function uploadImage(adAccountId: string, bytes: Buffer) {
    const form = new FormData();
    form.set('filename', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'veloxa.jpg');
    const result = await post<{ images?: Record<string, { hash?: string }> }>(`act_${adAccountId}/adimages`, form);
    const hash = Object.values(result.images || {})[0]?.hash;
    if (typeof hash !== 'string' || !/^[a-f0-9]{32}$/i.test(hash)) throw new MetaRequestError('Gambar iklan belum dapat dikonfirmasi oleh Meta.', true);
    return hash;
  }

  return { get, list, create, status, uploadImage };
}

export type MarketingGraph = ReturnType<typeof marketingGraph>;
export const adAccountFields = 'account_id,name,currency,account_status,user_tasks';

export function metaAdsAccount(row: Row) {
  const id = metaNumericId.safeParse(row.account_id);
  if (!id.success) return null;
  const currency = typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : '';
  const tasks = Array.isArray(row.user_tasks) ? row.user_tasks : [];
  return {
    id: id.data,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.slice(0, 160) : `Akun ${id.data}`,
    currency,
    eligible: row.account_status === 1 && currency === 'IDR' && (tasks.includes('ADVERTISE') || tasks.includes('MANAGE')),
  };
}

const normalizedPlace = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');

export async function metaAdsGeo(graph: MarketingGraph, city: string, radius: number) {
  if (normalizedPlace(city) === 'indonesia') return { countries: ['ID'] };
  const rows = await graph.list('search', { type: 'adgeolocation', location_types: '["city"]', country_code: 'ID', q: city });
  const cities = rows.filter(row => row.country_code === 'ID' && row.type === 'city' && typeof row.name === 'string' && normalizedPlace(row.name) === normalizedPlace(city));
  const key = cities.length === 1 ? metaNumericId.safeParse(cities[0].key) : null;
  if (!key?.success) throw new ApiError(409, 'Kota target tidak cocok dengan satu lokasi di Meta. Gunakan nama kota resmi atau pilih Indonesia pada rancangan baru.', 'meta_ads_location_unverified');
  return { cities: [{ key: key.data, radius, distance_unit: 'kilometer' }] };
}
