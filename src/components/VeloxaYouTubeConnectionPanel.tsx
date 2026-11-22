'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { VeloxaSelect } from '@/components/VeloxaSelect';
import { veloxaApi } from '@/lib/veloxa-api-client';

type YouTubeChannel = { channelId: string; title: string; handle: string; url: string };
type YouTubeConnection = YouTubeChannel & {
  status: 'connected' | 'reconnect_required';
  connectedAt: number;
  revision: string;
};
type YouTubeAccounts = {
  ok: boolean;
  configured: boolean;
  startRevision: number;
  connection: YouTubeConnection | null;
  channels: YouTubeChannel[];
  authorizationId?: string;
};
type ReviewStatus = 'authorized' | 'failed' | null;
type Action = 'starting' | 'saving' | 'disconnecting' | null;
type DisconnectConfirmation = Readonly<Pick<YouTubeConnection, 'channelId' | 'revision' | 'title'>>;
type ViewState = {
  scope: string;
  data: YouTubeAccounts | null;
  loading: boolean;
  busy: Action;
  selectedChannelId: string;
  error: string;
  notice: string;
  needsRefresh: boolean;
  confirmation: DisconnectConfirmation | null;
};

function emptyView(scope: string): ViewState {
  return { scope, data: null, loading: true, busy: null, selectedChannelId: '', error: '', notice: '', needsRefresh: false, confirmation: null };
}

const connectionChangedNotice = 'Koneksi YouTube berubah. Tinjau channel yang sekarang sebelum membuka konfirmasi putus koneksi yang baru.';

function sameConnectionBinding(first: Pick<YouTubeConnection, 'channelId' | 'revision'> | null | undefined, second: Pick<YouTubeConnection, 'channelId' | 'revision'> | null | undefined) {
  if (!first || !second) return !first && !second;
  return first.channelId === second.channelId && first.revision === second.revision;
}

function captureDisconnectConfirmation(connection: YouTubeConnection): DisconnectConfirmation {
  return Object.freeze({ channelId: connection.channelId, revision: connection.revision, title: connection.title });
}

function writeReturnIntent(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, serializedIntent: string) {
  storage.setItem(key, serializedIntent);
  if (storage.getItem(key) !== serializedIntent) throw new Error('Penyimpanan sesi belum dapat diverifikasi.');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Koneksi YouTube belum dapat diperiksa. Coba lagi.';
}

function parseAccountsResponse(raw: unknown): YouTubeAccounts {
  const invalid = () => { throw new Error('Status YouTube belum lengkap. Muat ulang untuk memeriksa kembali.'); };
  const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const bounded = (value: unknown, max: number, allowEmpty = false): value is string => typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
  function channel(value: unknown): YouTubeChannel {
    if (!record(value) || !bounded(value.channelId, 128) || !bounded(value.title, 500) || !bounded(value.handle, 256, true) || !bounded(value.url, 2048)) return invalid();
    return { channelId: value.channelId, title: value.title, handle: value.handle, url: value.url };
  }
  if (!record(raw) || raw.ok !== true || typeof raw.configured !== 'boolean' || typeof raw.startRevision !== 'number' || !Number.isSafeInteger(raw.startRevision) || raw.startRevision < 0 || !Array.isArray(raw.channels)) return invalid();
  const channels = raw.channels.map(channel);
  let connection: YouTubeConnection | null = null;
  if (raw.connection !== null) {
    if (!record(raw.connection) || !['connected', 'reconnect_required'].includes(String(raw.connection.status)) || typeof raw.connection.connectedAt !== 'number' || !Number.isFinite(raw.connection.connectedAt) || raw.connection.connectedAt <= 0 || !Number.isFinite(new Date(raw.connection.connectedAt).getTime()) || !bounded(raw.connection.revision, 512)) return invalid();
    const status = raw.connection.status;
    if (status !== 'connected' && status !== 'reconnect_required') return invalid();
    connection = { ...channel(raw.connection), status, connectedAt: raw.connection.connectedAt, revision: raw.connection.revision };
  }
  if (raw.authorizationId !== undefined && !bounded(raw.authorizationId, 512)) return invalid();
  if ((channels.length > 0) !== (raw.authorizationId !== undefined)) return invalid();
  return { ok: true, configured: raw.configured, startRevision: raw.startRevision, connection, channels, ...(raw.authorizationId !== undefined ? { authorizationId: raw.authorizationId } : {}) };
}

function channelLink(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function connectedDate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false }).format(date) + ' WIB';
}

/** A separate business-bound connection. It never writes to Meta's account list or publishing targets. */
export function VeloxaYouTubeConnectionPanel({ workspaceId, businessId, businessName = 'Bisnis aktif', reviewStatus = null }: {
  workspaceId: string;
  businessId: string;
  businessName?: string;
  reviewStatus?: ReviewStatus;
}) {
  const scope = `${workspaceId}:${businessId}`;
  const [storedView, setView] = useState<ViewState>(() => emptyView(scope));
  // Hide the previous business synchronously, before the scope effect runs.
  const view = storedView.scope === scope ? storedView : emptyView(scope);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const epoch = useRef(0);
  const mounted = useRef(false);
  const operation = useRef(false);
  const reading = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const returnFocusPending = useRef(false);
  const identity = useId();
  const headingId = `youtube-heading-${identity}`;
  const pickerId = `youtube-channel-${identity}`;
  const permissionsId = `youtube-permissions-${identity}`;
  const removeTitleId = `youtube-remove-title-${identity}`;
  const removeDescriptionId = `youtube-remove-description-${identity}`;

  function isCurrent(expectedEpoch: number) {
    return mounted.current && epoch.current === expectedEpoch && latestScope.current === scope;
  }

  function update(expectedEpoch: number, patch: Partial<ViewState>) {
    if (isCurrent(expectedEpoch)) setView(previous => previous.scope === scope ? { ...previous, ...patch } : previous);
  }

  async function request<T>(path: string, init: RequestInit, expectedEpoch: number): Promise<T> {
    const controller = new AbortController();
    requests.current.add(controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const result = await veloxaApi<T>(path, { ...init, signal: controller.signal });
      if (!isCurrent(expectedEpoch)) throw new DOMException('Bisnis berubah.', 'AbortError');
      return result;
    } catch (error) {
      if (!isCurrent(expectedEpoch)) throw new DOMException('Bisnis berubah.', 'AbortError');
      if (timedOut) throw new Error('Layanan YouTube belum merespons. Muat ulang status sebelum mencoba lagi.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
      requests.current.delete(controller);
    }
  }

  async function readAccounts(expectedEpoch: number) {
    reading.current = true;
    update(expectedEpoch, { loading: true, error: '' });
    try {
      const query = new URLSearchParams({ workspaceId, businessId });
      const response = await request<unknown>(`/api/veloxa/youtube/accounts?${query}`, {}, expectedEpoch);
      const result = parseAccountsResponse(response);
      if (!isCurrent(expectedEpoch)) return null;
      setView(previous => {
        if (previous.scope !== scope) return previous;
        const keepSelection = previous.data?.authorizationId === result.authorizationId && result.channels.some(channel => channel.channelId === previous.selectedChannelId);
        const bindingChanged = previous.data !== null && !sameConnectionBinding(previous.data.connection, result.connection);
        const invalidConfirmation = previous.confirmation && !sameConnectionBinding(previous.confirmation, result.connection);
        return { ...previous, data: result, selectedChannelId: keepSelection ? previous.selectedChannelId : '', loading: false, needsRefresh: false, error: '', confirmation: invalidConfirmation ? null : previous.confirmation, notice: bindingChanged || invalidConfirmation ? connectionChangedNotice : previous.notice };
      });
      return result;
    } catch (error) {
      if (isCurrent(expectedEpoch)) update(expectedEpoch, { loading: false, error: errorMessage(error), needsRefresh: true });
      return null;
    } finally {
      if (isCurrent(expectedEpoch)) reading.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    const expectedEpoch = ++epoch.current;
    operation.current = false;
    reading.current = false;
    setView(emptyView(scope));
    void readAccounts(expectedEpoch);
    return () => {
      mounted.current = false;
      ++epoch.current;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
    };
  }, [workspaceId, businessId, reviewStatus]); // A callback requires a fresh, business-bound grant review.

  useEffect(() => {
    if (reviewStatus) headingRef.current?.focus({ preventScroll: false });
  }, [workspaceId, businessId, reviewStatus]);

  useEffect(() => {
    const confirming = Boolean(view.confirmation);
    if (confirming && !wasConfirming.current) cancelRef.current?.focus({ preventScroll: true });
    if (!confirming && wasConfirming.current) returnFocusPending.current = true;
    wasConfirming.current = confirming;
    if (returnFocusPending.current && !confirming && !view.loading && !view.busy) {
      const preferred = view.needsRefresh ? refreshRef.current : view.data?.connection ? disconnectRef.current : connectRef.current;
      const target = preferred?.disabled ? refreshRef.current : preferred;
      target?.focus({ preventScroll: true });
      if (target) returnFocusPending.current = false;
    }
  }, [view.confirmation, view.loading, view.busy, view.needsRefresh, Boolean(view.data?.connection)]);

  async function perform(action: Exclude<Action, null>, work: (expectedEpoch: number) => Promise<void>) {
    if (operation.current || reading.current || !mounted.current || latestScope.current !== scope) return;
    operation.current = true;
    const expectedEpoch = epoch.current;
    update(expectedEpoch, { busy: action, error: '', notice: '' });
    try { await work(expectedEpoch); }
    catch (error) {
      if (isCurrent(expectedEpoch)) update(expectedEpoch, { error: errorMessage(error), ...(action !== 'starting' ? { needsRefresh: true } : {}), ...(action === 'disconnecting' ? { confirmation: null, notice: 'Konfirmasi putus koneksi ditutup. Perbarui status dan tinjau koneksi sebelum mencoba lagi.' } : {}) });
    } finally {
      if (isCurrent(expectedEpoch)) { operation.current = false; update(expectedEpoch, { busy: null }); }
    }
  }

  async function startConnection(expectedEpoch: number) {
    const startRevision = view.data?.startRevision;
    if (!isCurrent(expectedEpoch)) return;
    if (typeof startRevision !== 'number' || !Number.isSafeInteger(startRevision) || startRevision < 0) {
      update(expectedEpoch, { needsRefresh: true });
      throw new Error('Versi koneksi YouTube belum dapat diperiksa. Muat ulang status sebelum menghubungkan kembali.');
    }
    let serializedIntent = '';
    const intentKey = `veloxa:youtube:return:${workspaceId}`;
    try {
      serializedIntent = JSON.stringify({ workspaceId, businessId, createdAt: Date.now() });
      try { writeReturnIntent(sessionStorage, intentKey, serializedIntent); }
      catch { throw new Error('Browser belum dapat menyimpan dan memverifikasi bisnis tujuan. Izinkan penyimpanan sesi lalu coba lagi. Permintaan izin belum dikirim.'); }
      // Once a start is attempted, only a successful GET can unlock mutations.
      update(expectedEpoch, { needsRefresh: true });
      const result = await request<{ url: string }>('/api/veloxa/youtube/start', { method: 'POST', body: JSON.stringify({ workspaceId, businessId, startRevision }) }, expectedEpoch);
      if (!isCurrent(expectedEpoch)) return;
      let url: URL;
      try { url = new URL(result.url); }
      catch { throw new Error('Alamat izin Google belum valid. Muat ulang status sebelum mencoba lagi.'); }
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('Alamat izin Google belum valid. Muat ulang status sebelum mencoba lagi.');
      try { if (sessionStorage.getItem(intentKey) !== serializedIntent) throw new Error('Tujuan tidak tersimpan.'); }
      catch { throw new Error('Bisnis tujuan tidak lagi dapat diverifikasi sebelum membuka Google. Muat ulang status sebelum mencoba lagi.'); }
      if (isCurrent(expectedEpoch)) window.location.assign(url.href);
    } catch (error) {
      if (serializedIntent) try { if (sessionStorage.getItem(intentKey) === serializedIntent) sessionStorage.removeItem(intentKey); } catch { /* Session storage can be unavailable. */ }
      throw error;
    }
  }

  async function saveConnection(expectedEpoch: number) {
    const channelId = view.selectedChannelId;
    const authorizationId = view.data?.authorizationId;
    if (!authorizationId || !view.data?.channels.some(channel => channel.channelId === channelId)) return;
    await request('/api/veloxa/youtube/connection', { method: 'POST', body: JSON.stringify({ workspaceId, businessId, authorizationId, channelId }) }, expectedEpoch);
    const result = await readAccounts(expectedEpoch);
    if (!isCurrent(expectedEpoch)) return;
    if (!result || result.connection?.channelId !== channelId || result.connection.status !== 'connected') {
      update(expectedEpoch, { needsRefresh: true, error: 'Permintaan simpan sudah dikirim, tetapi koneksi belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.' });
      return;
    }
    update(expectedEpoch, { selectedChannelId: '', notice: 'Channel YouTube tersimpan untuk bisnis ini. Publikasi video belum tersedia.' });
  }

  async function disconnectConnection(expectedEpoch: number) {
    const confirmation = view.confirmation;
    if (!confirmation) throw new Error('Buka kembali konfirmasi untuk channel yang ingin diputus.');
    if (!sameConnectionBinding(confirmation, view.data?.connection)) {
      update(expectedEpoch, { confirmation: null, notice: connectionChangedNotice });
      return;
    }
    const { channelId, revision } = confirmation;
    await request('/api/veloxa/youtube/connection', { method: 'DELETE', body: JSON.stringify({ workspaceId, businessId, channelId, revision }) }, expectedEpoch);
    const result = await readAccounts(expectedEpoch);
    if (!isCurrent(expectedEpoch)) return;
    if (!result || result.connection !== null) {
      update(expectedEpoch, { needsRefresh: true, error: 'Permintaan putus koneksi sudah dikirim, tetapi hasilnya belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.' });
      return;
    }
    update(expectedEpoch, { confirmation: null, selectedChannelId: '', notice: 'Koneksi YouTube untuk bisnis ini sudah diputus.' });
  }

  const data = view.data;
  const connection = data?.connection;
  const disabled = view.loading || Boolean(view.busy);
  const canMutate = !disabled && !view.needsRefresh;
  const selectedChannel = data?.channels.find(channel => channel.channelId === view.selectedChannelId);
  const url = connection ? channelLink(connection.url) : null;
  const date = connection ? connectedDate(connection.connectedAt) : '';

  return <section aria-labelledby={headingId} aria-busy={disabled} className="mt-6 min-w-0 space-y-5 border-t border-neutral-200 pt-6 text-base [&_button]:!min-h-11" data-testid="youtube-connection-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 ref={headingRef} id={headingId} tabIndex={-1} className="text-xl font-semibold">YouTube</h3><p className="mt-1 break-words text-sm text-neutral-500">Untuk {businessName}</p></div>
      <span className="rounded-md bg-[#faf2f5] px-2 py-1 text-xs font-medium text-[#682943]">Persiapan koneksi</span>
    </div>
    <p id={permissionsId} className="text-base leading-relaxed text-neutral-600">Veloxa hanya meminta izin untuk melihat channel YouTube Anda. Unggah dan publikasi video belum tersedia.</p>

    {reviewStatus === 'failed' && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900" data-testid="youtube-callback-failed">Izin YouTube belum berhasil atau dibatalkan. Periksa status di bawah, lalu hubungkan kembali jika diperlukan.</p>}
    {reviewStatus === 'authorized' && <p role="status" className="rounded-lg border border-[#ead4de] bg-[#faf2f5] p-3 text-sm leading-relaxed text-[#682943]" data-testid="youtube-callback-authorized">Anda kembali dari Google. Koneksi belum otomatis disimpan; tinjau channel untuk bisnis ini terlebih dahulu.</p>}
    {view.notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-base leading-relaxed text-emerald-900" data-testid="youtube-notice">{view.notice}</p>}
    {view.error && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-base text-amber-900" data-testid="youtube-error"><p role="alert">{view.error}</p><p className="text-sm leading-relaxed">{data ? 'Data yang tampil adalah hasil pemeriksaan terakhir. Perbarui status sebelum mengubah koneksi.' : 'Status koneksi belum diketahui. Coba periksa kembali.'}</p><button type="button" disabled={disabled} onClick={() => { if (!operation.current && !reading.current) void readAccounts(epoch.current); }} className="veloxa-button-secondary min-h-11" data-testid="youtube-retry">{view.loading ? 'Memeriksa…' : 'Muat ulang status'}</button></div>}
    {view.loading && <p role="status" className="text-sm text-neutral-500" data-testid="youtube-loading">Memeriksa koneksi YouTube…</p>}

    {data && <>
      {!data.configured && <p role="status" className="rounded-lg bg-neutral-50 p-4 text-base leading-relaxed text-neutral-600" data-testid="youtube-unavailable">Koneksi YouTube sedang disiapkan. Anda dapat menghubungkan channel setelah layanan ini tersedia.</p>}
      {connection ? <div className="min-w-0 space-y-3 rounded-lg border border-neutral-200 p-4" data-testid="youtube-saved-connection">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm text-neutral-500">Channel tersimpan</p><p className="mt-1 break-words text-base font-semibold">{connection.title}</p>{connection.handle && <p className="mt-1 break-words text-sm text-neutral-600">{connection.handle}</p>}</div><span className={`text-sm font-medium ${view.needsRefresh ? 'text-amber-800' : connection.status === 'connected' ? 'text-emerald-800' : 'text-amber-800'}`} data-testid="youtube-saved-status">{view.needsRefresh ? 'Status belum diperbarui' : connection.status === 'connected' ? 'Terhubung' : 'Hubungkan kembali'}</span></div>
        {date && <p className="text-sm text-neutral-500">Tersimpan sejak {date}</p>}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-[#682943] underline underline-offset-4">Buka channel YouTube ↗</a>}
        <p className="text-sm leading-relaxed text-neutral-600" data-testid="youtube-publishing-unavailable">Koneksi ini hanya untuk persiapan akun. YouTube belum menjadi tujuan publikasi di Content Studio atau Jadwal konten.</p>
      </div> : !view.loading && !view.needsRefresh && <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-base text-neutral-600" data-testid="youtube-empty">Belum ada channel YouTube tersimpan untuk bisnis ini.</p>}

      {!!data.channels.length && <fieldset disabled={!canMutate || !data.configured || !data.authorizationId} className="min-w-0 space-y-3 rounded-lg border border-[#e7d4dd] bg-[#fcf8fa] p-4" data-testid="youtube-pending-channels">
        <legend className="px-1 text-base font-semibold">Tinjau channel dari Google</legend><p className="text-sm leading-relaxed text-neutral-600">Pilihan ini belum disimpan. Pilih channel yang sesuai untuk {businessName}, lalu simpan koneksinya.</p>
        <label htmlFor={pickerId} className="block text-sm font-medium">Channel YouTube untuk bisnis ini</label>
        <VeloxaSelect id={pickerId} value={view.selectedChannelId} onValueChange={channelId => update(epoch.current, { selectedChannelId: channelId, notice: '' })} disabled={!canMutate || !data.configured || !data.authorizationId} placeholder="Pilih channel YouTube" className="!min-h-11" aria-describedby={permissionsId} data-testid="youtube-channel-picker">
          {data.channels.map(channel => <option key={channel.channelId} value={channel.channelId}>{channel.title}{channel.handle ? ` · ${channel.handle}` : ''}</option>)}
        </VeloxaSelect>
        {selectedChannel && <p className="break-words text-sm text-[#682943]" data-testid="youtube-unsaved-selection">Belum disimpan: {selectedChannel.title}</p>}
        <button type="button" disabled={!canMutate || !data.configured || !data.authorizationId || !selectedChannel} onClick={() => void perform('saving', saveConnection)} className="veloxa-button-primary min-h-11 w-full" data-testid="youtube-save-channel">{view.busy === 'saving' ? 'Menyimpan channel…' : 'Simpan channel'}</button>
      </fieldset>}
      {!!data.channels.length && !data.authorizationId && <p role="status" className="text-sm leading-relaxed text-amber-900">Izin untuk menyimpan channel belum dapat diperiksa. Muat ulang status atau hubungkan kembali.</p>}
      {reviewStatus === 'authorized' && !view.loading && !data.channels.length && <p role="status" className="text-sm leading-relaxed text-neutral-600" data-testid="youtube-no-pending-channels">Belum ada channel yang dapat ditinjau untuk bisnis ini. Pastikan bisnis aktif sama dengan bisnis saat memberi izin, atau hubungkan YouTube kembali.</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button ref={connectRef} type="button" disabled={!canMutate || !data.configured} aria-describedby={permissionsId} onClick={() => void perform('starting', startConnection)} className="veloxa-button-secondary min-h-11" data-testid="youtube-connect">{view.busy === 'starting' ? 'Membuka Google…' : connection ? 'Hubungkan kembali YouTube' : 'Hubungkan YouTube'}</button>
        <button ref={refreshRef} type="button" disabled={disabled} onClick={() => { if (!operation.current && !reading.current) void readAccounts(epoch.current); }} className="veloxa-button-secondary min-h-11" data-testid="youtube-refresh">{view.loading ? 'Memeriksa…' : 'Perbarui status'}</button>
        {connection && <button ref={disconnectRef} type="button" disabled={!canMutate} onClick={() => update(epoch.current, { confirmation: captureDisconnectConfirmation(connection) })} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 px-4 py-2.5 text-base font-medium text-red-800" data-testid="youtube-disconnect">Putuskan koneksi</button>}
      </div>
    </>}

    {view.confirmation && <div role="alertdialog" aria-labelledby={removeTitleId} aria-describedby={removeDescriptionId} className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!view.busy) update(epoch.current, { confirmation: null }); } }} data-testid="youtube-disconnect-dialog">
      <h4 id={removeTitleId} className="break-words text-base font-semibold">Putuskan {view.confirmation.title} dari {businessName}?</h4><p id={removeDescriptionId} className="text-sm leading-relaxed text-red-900">Ini menghapus koneksi YouTube untuk bisnis ini di Veloxa. Koneksi bisnis lain tetap tersimpan dan izin akun Google tidak dicabut secara menyeluruh.</p>
      <div className="flex flex-col gap-3 sm:flex-row"><button ref={cancelRef} type="button" disabled={disabled} onClick={() => update(epoch.current, { confirmation: null })} className="veloxa-button-secondary min-h-11" data-testid="youtube-disconnect-cancel">Batal</button><button type="button" disabled={!canMutate} onClick={() => void perform('disconnecting', disconnectConnection)} className="veloxa-button-primary min-h-11" data-testid="youtube-disconnect-confirm">{view.busy === 'disconnecting' ? 'Memutus koneksi…' : 'Ya, putuskan koneksi'}</button></div>
    </div>}
  </section>;
}
