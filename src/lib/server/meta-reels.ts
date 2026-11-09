import { ApiError } from './http';
import { graphRequest, getMetaLoginProvider, MetaRequestError, type publishMetaImage } from './meta-graph';

type Params = Pick<Parameters<typeof publishMetaImage>[0], 'channel' | 'accountId' | 'token' | 'caption' | 'loginProvider'> & { videoUrl: string; videoBytes: Buffer };
type Deps = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> };
const uncertain = () => new MetaRequestError('Hasil publikasi Reels belum dapat dipastikan. Periksa akun sebelum mencoba ulang.', true);
async function beforePublish<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof MetaRequestError) throw new MetaRequestError(error.message, false, error.providerCode);
    throw new MetaRequestError('Media Reels belum dapat disiapkan. Belum ada Reels diterbitkan.');
  }
}
export async function publishMetaReel(params: Params, deps: Deps = {}): Promise<{ externalPostId: string; permalink?: string }> {
  let mediaUrl: URL;
  try { mediaUrl = new URL(params.videoUrl); } catch { throw new ApiError(400, 'URL video tidak valid.'); }
  if (!['facebook', 'instagram'].includes(params.channel) || !/^\d+$/.test(params.accountId) || typeof params.token !== 'string' || !params.token.trim() || mediaUrl.protocol !== 'https:' || mediaUrl.username || mediaUrl.password || !Buffer.isBuffer(params.videoBytes) || !params.videoBytes.length || params.videoBytes.length > 30 * 1024 * 1024 || typeof params.caption !== 'string' || [...params.caption].length > 2200) throw new ApiError(400, 'Video atau akun tujuan Reels tidak valid.');
  const provider = getMetaLoginProvider(params.loginProvider);
  if (params.channel === 'facebook' && provider !== 'facebook') throw new ApiError(409, 'Koneksi Instagram langsung tidak dapat menerbitkan ke Facebook.');
  const request = <T>(path: string, method: 'GET' | 'POST', values: Record<string, string>) => graphRequest<T>(path, params.token, method, values, deps.fetcher, provider);
  const sleep = deps.sleep || ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  if (params.channel === 'instagram') {
    const container = await beforePublish(() => request<{ id?: string }>(`${params.accountId}/media`, 'POST', { media_type: 'REELS', video_url: params.videoUrl, caption: params.caption, share_to_feed: 'true' }));
    if (!container.id || !/^\d+$/.test(container.id)) throw new MetaRequestError('Kontainer Reels Instagram belum tersedia.');
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const state = await beforePublish(() => request<{ status_code?: string }>(container.id!, 'GET', { fields: 'status_code' }));
      if (state.status_code === 'FINISHED') { ready = true; break; }
      if (['ERROR', 'EXPIRED'].includes(state.status_code || '')) throw new MetaRequestError('Instagram gagal memproses video. Belum ada Reels diterbitkan.');
      if (i < 19) await sleep(1500);
    }
    if (!ready) throw new MetaRequestError('Instagram masih memproses video. Belum ada Reels diterbitkan.');
    let published: { id?: string };
    try { published = await request<{ id?: string }>(`${params.accountId}/media_publish`, 'POST', { creation_id: container.id }); }
    catch (error) { if (error instanceof MetaRequestError) throw error; throw uncertain(); }
    if (!published.id || !/^\d+$/.test(published.id)) throw uncertain();
    let permalink: string | undefined;
    try { permalink = (await request<{ permalink?: string }>(published.id, 'GET', { fields: 'permalink' })).permalink; } catch { /* A confirmed remote ID remains the receipt. */ }
    return { externalPostId: published.id, permalink };
  }
  const start = await beforePublish(() => request<{ video_id?: string; upload_url?: string }>(`${params.accountId}/video_reels`, 'POST', { upload_phase: 'start' }));
  if (!start.video_id || !/^\d+$/.test(start.video_id) || !start.upload_url) throw new MetaRequestError('Unggahan Reels Facebook belum tersedia.');
  let uploadUrl: URL;
  try { uploadUrl = new URL(start.upload_url); } catch { throw new MetaRequestError('Alamat unggahan Reels tidak valid.'); }
  const uploadPath = /^\/video-upload\/v\d+\.\d+\/(\d+)$/.exec(uploadUrl.pathname);
  if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'rupload.facebook.com' || uploadUrl.port || uploadUrl.username || uploadUrl.password || uploadUrl.search || uploadUrl.hash || uploadPath?.[1] !== start.video_id) throw new MetaRequestError('Alamat unggahan Reels tidak valid.');
  await beforePublish(async () => {
    const uploaded = await (deps.fetcher || fetch)(uploadUrl, { method: 'POST', headers: { Authorization: `OAuth ${params.token}`, offset: '0', file_size: String(params.videoBytes.length), 'Content-Type': 'application/octet-stream' }, body: new Blob([new Uint8Array(params.videoBytes)], { type: 'application/octet-stream' }), redirect: 'error', signal: AbortSignal.timeout(25_000) });
    const result = await uploaded.json();
    if (!uploaded.ok || result?.success !== true) throw new MetaRequestError('Unggahan video Facebook gagal. Belum ada Reels diterbitkan.');
  });
  let finish: { success?: boolean };
  try { finish = await request(`${params.accountId}/video_reels`, 'POST', { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: params.caption }); }
  catch (error) { if (error instanceof MetaRequestError) throw error; throw uncertain(); }
  if (finish.success !== true) throw uncertain();
  for (let i = 0; i < 20; i++) {
    let result: { status?: { video_status?: string; publishing_phase?: { status?: string; publish_status?: string } } };
    try { result = await request(start.video_id, 'GET', { fields: 'status' }); } catch { throw uncertain(); }
    const state = result.status;
    if (state?.video_status === 'ready' && (state.publishing_phase?.publish_status === 'published' || state.publishing_phase?.status === 'complete')) return { externalPostId: start.video_id, permalink: `https://www.facebook.com/reel/${start.video_id}/` };
    if (state?.video_status === 'error') throw uncertain();
    if (i < 19) await sleep(1500);
  }
  throw uncertain();
}
