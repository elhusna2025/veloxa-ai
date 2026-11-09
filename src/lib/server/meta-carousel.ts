import { ApiError } from './http';
import { graphRequest, getMetaLoginProvider, MetaRequestError, type MetaChannel, type MetaLoginProvider } from './meta-graph';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_COUNT = 5;

type CarouselImage = { imageUrl: string; imageBytes: Buffer };
type RequestValues = Record<string, string> | FormData;
type CarouselParams = {
  channel: MetaChannel;
  accountId: string;
  token: string;
  images: CarouselImage[];
  caption: string;
  loginProvider?: MetaLoginProvider;
};
type Dependencies = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> };

function validate(params: CarouselParams) {
  if (!/^\d+$/.test(params.accountId)) throw new ApiError(409, 'ID akun Meta tidak valid. Hubungkan ulang akun.');
  if (typeof params.token !== 'string' || !params.token.trim()) throw new ApiError(409, 'Izin Meta tidak tersedia. Hubungkan ulang akun.');
  if (!Array.isArray(params.images) || params.images.length !== IMAGE_COUNT) throw new ApiError(400, 'Carousel harus berisi tepat lima gambar.');
  for (const image of params.images) {
    let url: URL;
    try { url = new URL(image.imageUrl); } catch { throw new ApiError(400, 'URL gambar carousel tidak valid.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(400, 'URL gambar carousel harus menggunakan HTTPS.');
    if (!Buffer.isBuffer(image.imageBytes) || image.imageBytes.length < 1 || image.imageBytes.length > MAX_IMAGE_BYTES) {
      throw new ApiError(400, 'Setiap gambar carousel harus berukuran maksimal 8 MB dan tidak kosong.');
    }
  }
}

async function definitive<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof MetaRequestError) throw new MetaRequestError(error.message, false, error.providerCode);
    throw new MetaRequestError('Meta menolak permintaan sebelum publikasi selesai.');
  }
}

export async function publishMetaCarousel(
  params: CarouselParams,
  deps: Dependencies = {},
): Promise<{ externalPostId: string; permalink?: string }> {
  validate(params);
  const provider = getMetaLoginProvider(params.loginProvider);
  if (params.channel === 'facebook' && provider !== 'facebook') throw new ApiError(409, 'Koneksi Instagram langsung tidak dapat menerbitkan ke Facebook.');
  const request = <T>(path: string, method: 'GET' | 'POST', values: RequestValues = {}) =>
    graphRequest<T>(path, params.token, method, values, deps.fetcher, provider);
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  if (params.channel === 'instagram') {
    const childIds: string[] = [];
    for (const image of params.images) {
      const child = await definitive(() => request<{ id?: string }>(`${params.accountId}/media`, 'POST', {
        image_url: image.imageUrl,
        is_carousel_item: 'true',
      }));
      if (!child.id || !/^\d+$/.test(child.id)) throw new MetaRequestError('Instagram belum menghasilkan kontainer gambar carousel.');
      childIds.push(child.id);
    }

    for (const childId of childIds) {
      let childFinished = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const state = await definitive(() => request<{ status_code?: string }>(childId, 'GET', { fields: 'status_code' }));
        if (state.status_code === 'FINISHED') { childFinished = true; break; }
        if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new MetaRequestError('Instagram gagal memproses gambar carousel. Periksa format dan akses media.');
        await sleep(1500);
      }
      if (!childFinished) throw new MetaRequestError('Instagram masih memproses gambar carousel. Belum ada posting diterbitkan.');
    }

    const parent = await definitive(() => request<{ id?: string }>(`${params.accountId}/media`, 'POST', {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption: params.caption,
    }));
    if (!parent.id || !/^\d+$/.test(parent.id)) throw new MetaRequestError('Instagram belum menghasilkan kontainer carousel.');

    let parentFinished = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await definitive(() => request<{ status_code?: string }>(parent.id!, 'GET', { fields: 'status_code' }));
      if (state.status_code === 'FINISHED') { parentFinished = true; break; }
      if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new MetaRequestError('Instagram gagal memproses carousel. Periksa format dan akses media.');
      await sleep(1500);
    }
    if (!parentFinished) throw new MetaRequestError('Instagram masih memproses carousel. Belum ada posting diterbitkan.');

    let published: { id?: string };
    try { published = await request<{ id?: string }>(`${params.accountId}/media_publish`, 'POST', { creation_id: parent.id }); }
    catch (error) {
      if (error instanceof MetaRequestError) throw error;
      throw new MetaRequestError('Hasil publikasi Instagram belum dapat dipastikan. Periksa akun sebelum mencoba ulang.', true);
    }
    if (!published.id || !/^\d+$/.test(published.id)) throw new MetaRequestError('Hasil publikasi Instagram belum dapat dipastikan.', true);

    let permalink: string | undefined;
    try { permalink = (await request<{ permalink?: string }>(published.id, 'GET', { fields: 'permalink' })).permalink; }
    catch { /* ID publikasi tetap menjadi bukti keberhasilan. */ }
    return { externalPostId: published.id, permalink };
  }

  const photoIds: string[] = [];
  for (const image of params.images) {
    const form = new FormData();
    form.set('source', new Blob([new Uint8Array(image.imageBytes)], { type: 'image/jpeg' }), 'veloxa.jpg');
    form.set('published', 'false');
    const photo = await definitive(() => request<{ id?: string }>(`${params.accountId}/photos`, 'POST', form));
    if (!photo.id || !/^\d+$/.test(photo.id)) throw new MetaRequestError('Meta belum mengembalikan ID foto Page yang valid.');
    photoIds.push(photo.id);
  }

  let published: { id?: string };
  try {
    published = await request<{ id?: string }>(`${params.accountId}/feed`, 'POST', {
      message: params.caption,
      attached_media: JSON.stringify(photoIds.map(media_fbid => ({ media_fbid }))),
    });
  } catch (error) {
    if (error instanceof MetaRequestError) throw error;
    throw new MetaRequestError('Hasil publikasi Facebook belum dapat dipastikan. Periksa Page sebelum mencoba ulang.', true);
  }
  if (!published.id || !/^\d+(?:_\d+)?$/.test(published.id)) throw new MetaRequestError('Hasil publikasi Facebook belum dapat dipastikan.', true);
  return { externalPostId: published.id, permalink: `https://www.facebook.com/${encodeURIComponent(published.id)}` };
}
