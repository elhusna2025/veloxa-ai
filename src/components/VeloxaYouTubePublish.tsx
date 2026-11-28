'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { VeloxaSelect } from './VeloxaSelect';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { youtubeUploadApi, verifiedGoogleAuthorization, youtubeUploadReturnKey } from '@/lib/youtube-upload-client';
import type { YouTubeProduction } from '@/lib/youtube-production';
import type { YouTubeUploadMetadata, YouTubeUploadOperation, YouTubeUploadPermission } from '@/lib/youtube-upload-types';

type Props = { thumbnailPreview?: string; workspaceId: string; businessId: string; production: YouTubeProduction; onManageConnection: () => void; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void };
const field = 'min-h-11 w-full min-w-0 rounded-lg border bg-white p-3 text-base';
export function VeloxaYouTubePublish(props: Props) {
  const { production, onBusyChange, onDirtyChange } = props;
  const scope = useMemo(() => ({ workspaceId: props.workspaceId, businessId: props.businessId }), [props.workspaceId, props.businessId]);
  const api = useMemo(() => youtubeUploadApi(scope), [scope]);
  const initial = useMemo<YouTubeUploadMetadata>(() => ({ title: production.outline?.title ?? '', description: (production.outline?.description ?? '') + '\n\nVideo dan suara dibuat dengan bantuan AI.', privacy: 'private', madeForKids: false, containsSyntheticMedia: true }), [production.outline?.title, production.outline?.description]);
  const [metadata, setMetadata] = useState(initial), [confirmed, setConfirmed] = useState(false);
  const [permission, setPermission] = useState<YouTubeUploadPermission | null>(null), [operation, setOperation] = useState<YouTubeUploadOperation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [locked, setLocked] = useState(false);
  useEffect(() => { setConfirmed(false); }, [production.thumbnails?.selected]);
  const operationId = operation?.id, operationState = operation?.state;
  const load = useCallback(async () => { const [grant, jobs] = await Promise.all([api.permission(), api.list()]); setPermission(grant); setOperation(jobs.operations.find(job => job.id === production.id) ?? null); }, [api, production.id]);
  useEffect(() => { void load().catch(failure => setError(failure.message)); }, [load]);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => { onDirtyChange(!operation && (JSON.stringify(metadata) !== JSON.stringify(initial) || confirmed || locked)); return () => onDirtyChange(false); }, [metadata, initial, confirmed, locked, operation, onDirtyChange]);
  useEffect(() => {
    if (!operationId || !operationState || !['validating', 'queued', 'uploading', 'processing', 'retry_wait'].includes(operationState)) return;
    const controller = new AbortController(); let running = false;
    const check = async () => { if (running) return; running = true; try { const value = await api.action(operationId, 'process', controller.signal); if (!controller.signal.aborted) setOperation(value); } catch { /* Inspect the same operation on the next interval. */ } finally { running = false; } };
    void check(); const timer = setInterval(() => { void check(); }, 8000); return () => { controller.abort(); clearInterval(timer); };
  }, [operationId, operationState, api]);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Permintaan belum selesai.'); } finally { setBusy(false); } }
  const connection = permission?.connection;
  function grant() { if (!connection || !permission) return; void run(async () => {
    const response = await api.startPermission({ channelId: connection.channelId, connectionRevision: connection.revision, startRevision: permission.startRevision });
    sessionStorage.setItem(youtubeUploadReturnKey(scope.workspaceId), JSON.stringify({ ...scope, createdAt: Date.now() }));
    window.location.assign(verifiedGoogleAuthorization(response.url));
  }); }
  function publish() { if (!connection || !permission?.canUpload || !confirmed) return; void run(async () => {
    setLocked(true);
    const result = await veloxaApi<{ operation: YouTubeUploadOperation }>(`/api/veloxa/youtube/productions/${production.id}/publish/?${new URLSearchParams(scope)}`, { method: 'POST', redirect: 'error', body: JSON.stringify({ channelId: connection.channelId, connectionRevision: connection.revision, metadata, thumbnailId: production.thumbnails?.selected ?? null, confirmed: true }) });
    setOperation(result.operation); setLocked(false);
  }); }
  const disabled = busy || locked || Boolean(operation);
  return <section className="veloxa-panel min-w-0 space-y-5 p-4 sm:p-6"><h3 className="text-lg font-semibold">Kirim video ke YouTube</h3><p className="text-base text-neutral-600">Video hasil produksi dikirim langsung dari Veloxa setelah Anda meninjau tujuan dan visibilitasnya.</p>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {!connection ? <button className="veloxa-button-secondary" onClick={props.onManageConnection}>Hubungkan channel YouTube</button> : <p className="font-medium">Channel tujuan: {connection.title} {connection.handle}</p>}
    {permission?.pending && <div className="space-y-3 rounded-lg border p-4"><p>Izin baru dari Google untuk {permission.pending.title}. Tinjau dan simpan izin untuk channel ini.</p><button className="veloxa-button-primary" disabled={busy} onClick={() => { void run(async () => { await api.confirmPermission(permission.pending!); await load(); }); }}>Simpan izin unggah</button></div>}
    {connection && !permission?.canUpload && !permission?.pending && <button className="veloxa-button-secondary" disabled={busy} onClick={grant}>Berikan izin unggah melalui Google</button>}
    {permission && !permission.uploadStorageReady && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">Publikasi belum diaktifkan oleh admin. Video produksi tetap dapat ditinjau dan diunduh.</p>}
    {production.settings.minutes > 15 && <p className="text-sm text-neutral-600">Untuk video lebih dari 15 menit, channel perlu mengaktifkan fitur video panjang melalui <a className="underline" href="https://www.youtube.com/verify" target="_blank" rel="noopener noreferrer">verifikasi YouTube</a>.</p>}
    {!operation && props.thumbnailPreview && <figure className="space-y-1"><img src={props.thumbnailPreview} alt="Thumbnail yang akan dikirim" className="aspect-video w-40 rounded-lg" /><figcaption className="text-sm">Thumbnail yang akan dikirim</figcaption></figure>}
    {!operation ? <><label className="block space-y-2"><span className="text-sm font-medium">Judul YouTube</span><input disabled={disabled} maxLength={100} value={metadata.title} onChange={event => setMetadata(value => ({ ...value, title: event.target.value }))} className={field} /></label><label className="block space-y-2"><span className="text-sm font-medium">Deskripsi</span><textarea disabled={disabled} rows={5} value={metadata.description} onChange={event => setMetadata(value => ({ ...value, description: event.target.value }))} className={field} /></label><label className="block space-y-2"><span className="text-sm font-medium">Visibilitas</span><VeloxaSelect disabled={disabled} aria-label="Visibilitas YouTube" value={metadata.privacy} onValueChange={privacy => setMetadata(value => ({ ...value, privacy: privacy as typeof value.privacy }))}><option value="private">Pribadi</option><option value="unlisted">Tidak publik · akses melalui tautan</option><option value="public">Publik</option></VeloxaSelect></label>
      <label className="flex items-start gap-3 text-base"><input type="checkbox" disabled={disabled} className="mt-1 size-5 shrink-0" checked={metadata.madeForKids} onChange={event => setMetadata(value => ({ ...value, madeForKids: event.target.checked }))} />Video ini ditujukan khusus untuk anak-anak.</label>
      <label className="flex items-start gap-3 text-base"><input type="checkbox" disabled={disabled} className="mt-1 size-5 shrink-0" checked={metadata.containsSyntheticMedia} onChange={event => setMetadata(value => ({ ...value, containsSyntheticMedia: event.target.checked }))} />Video berisi orang, adegan atau suara realistis yang dibuat atau diubah dengan AI.</label>
      <label className="flex items-start gap-3 text-base"><input type="checkbox" disabled={disabled} className="mt-1 size-5 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Saya sudah menonton video dan meninjau channel tujuan, judul, deklarasi, serta visibilitasnya.</label>
      <button disabled={busy || !confirmed || !permission?.canUpload || !permission.uploadStorageReady || !metadata.title.trim()} className="veloxa-button-primary" onClick={publish}>{locked ? 'Periksa pengiriman yang sama' : busy ? 'Menyimpan pengiriman…' : metadata.privacy === 'public' ? 'Terbitkan video ke YouTube' : 'Kirim video ke YouTube'}</button></> : <div role="status" className="space-y-3 rounded-lg border p-4"><p className="font-medium">{operation.video ? 'Video sudah diterima YouTube' : 'Status pengiriman: ' + operation.state}</p>{operation.message && <p>{operation.message}</p>}<p>{operation.youtubeBytes.toLocaleString('id-ID')} dari {operation.totalBytes.toLocaleString('id-ID')} byte dikonfirmasi.</p>{operation.video && <a className="veloxa-button-secondary" target="_blank" rel="noopener noreferrer" href={operation.video.url}>Buka video · {operation.video.privacy}</a>}{operation.state === 'needs_review' && <button className="veloxa-button-secondary" disabled={busy} onClick={() => { void run(async () => setOperation(await api.action(operation.id, 'check'))); }}>Periksa hasil pengiriman yang sama</button>}</div>}
  </section>;
}
