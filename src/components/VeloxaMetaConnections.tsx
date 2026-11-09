'use client';
import { useCallback, useEffect, useState } from 'react';
import { veloxaApi } from '@/lib/veloxa-api-client';
import type { ChannelConnectionState } from '@/lib/veloxa-types';

type Accounts = { instagramLoginAvailable?: boolean; instagramAccounts?: { accountId: string; username: string }[]; pages: { pageId: string; pageName: string; instagramHandle: string }[]; connections: ChannelConnectionState[] };
export function VeloxaMetaConnections({ workspaceId, onConnections, initialChannel = 'instagram', reviewAccounts = false }: { workspaceId: string; onConnections: (connections: ChannelConnectionState[]) => void; initialChannel?: string; reviewAccounts?: boolean }) {
  const [accounts, setAccounts] = useState<Accounts>({ pages: [], connections: [] });
  const [pageId, setPageId] = useState('');
  const [instagramAccountId, setInstagramAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<'instagram' | 'facebook'>(initialChannel === 'facebook' ? 'facebook' : 'instagram');
  const [managing, setManaging] = useState(false);
  useEffect(() => { setMethod(initialChannel === 'facebook' ? 'facebook' : 'instagram'); setManaging(reviewAccounts); }, [initialChannel, reviewAccounts]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setError('');
      const result = await veloxaApi<Accounts>(`/api/veloxa/meta/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
      setAccounts(result); setPageId(current => result.pages.some(page => page.pageId === current) ? current : result.connections.find(connection => connection.channel === 'facebook')?.handle || result.pages[0]?.pageId || '');
      setInstagramAccountId(current => result.instagramAccounts?.some(account => account.accountId === current) ? current : result.instagramAccounts?.[0]?.accountId || '');
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : 'Status koneksi belum dapat dimuat.'); return null; }
    finally { setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Koneksi belum berhasil.'); }
    finally { setBusy(false); }
  }
  const instagramConnected = accounts.connections.some(item => item.channel === 'instagram' && item.connected);
  const facebookConnected = accounts.connections.some(item => item.channel === 'facebook' && item.connected);
  const selectedConnected = method === 'instagram' ? instagramConnected : facebookConnected;
  const selectedPage = accounts.pages.find(page => page.pageId === pageId);
  return <section className="mt-5 space-y-4 text-base" aria-label="Koneksi akun sosial">
    <p className="text-neutral-600">Pilih cara menghubungkan akun. Instagram saja tidak memerlukan akun Facebook atau Facebook Page.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Pilih metode koneksi">
      <button type="button" aria-pressed={method === 'instagram'} disabled={busy} onClick={() => { setMethod('instagram'); setManaging(false); setMessage(''); }} className={`rounded-xl border p-4 text-left ${method === 'instagram' ? 'border-pink-400 bg-pink-50' : 'border-neutral-200 bg-white'}`}>
        <strong className="block text-base">Instagram saja</strong><span className="mt-1 block text-neutral-600">Masuk langsung dengan Instagram, tanpa Facebook Page.</span>
      </button>
      <button type="button" aria-pressed={method === 'facebook'} disabled={busy} onClick={() => { setMethod('facebook'); setManaging(false); setMessage(''); }} className={`rounded-xl border p-4 text-left ${method === 'facebook' ? 'border-pink-400 bg-pink-50' : 'border-neutral-200 bg-white'}`}>
        <strong className="block text-base">Facebook + Instagram</strong><span className="mt-1 block text-neutral-600">Hubungkan Facebook Page dan Instagram yang tertaut.</span>
      </button>
    </div>
    <p className="rounded-xl bg-neutral-50 p-3 text-neutral-600">Instagram harus berupa akun profesional (Business atau Creator). Akun pribadi perlu diubah menjadi akun profesional sebelum dihubungkan. Veloxa tidak meminta password akun sosial Anda.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {loading && <p role="status">Memuat status koneksi…</p>}
    {accounts.connections.length > 0 && <div><h3 className="mb-2 font-medium">Akun yang sudah terhubung</h3><ul className="space-y-2">{accounts.connections.map(connection => <li key={connection.channel} className="rounded-xl border p-3"><strong>{connection.channel === 'facebook' ? 'Facebook Page' : 'Instagram'}</strong> · {connection.channel === 'instagram' ? connection.handle || connection.accountName : connection.accountName} — {connection.connected ? 'Terhubung' : 'Perlu dihubungkan ulang'}</li>)}</ul></div>}
    {selectedConnected && <div className="rounded-xl bg-emerald-50 p-4 text-emerald-800"><p>{method === 'instagram' ? 'Instagram sudah terhubung. Buat post tunggal, carousel, atau Reels di Content Studio.' : 'Facebook Page sudah terhubung. Akun tujuan akan ditampilkan saat meninjau publikasi.'}</p><button type="button" disabled={busy || loading} onClick={() => setManaging(value => !value)} className="mt-3 font-medium underline">{managing ? 'Tutup pengaturan koneksi' : 'Ganti atau hubungkan ulang akun'}</button></div>}
    {(!selectedConnected || managing) && <div className="space-y-4">
      {method === 'instagram' ? <div className="space-y-3">
        <h3 className="font-medium">Hubungkan Instagram langsung</h3>
        <ol className="list-inside list-decimal space-y-1 text-neutral-600"><li>Pilih masuk dengan Instagram pada halaman Meta.</li><li>Pilih business portfolio dan akun Instagram profesional Anda, lalu setujui izin.</li><li>Kembali ke Veloxa dan pilih akun Instagram untuk workspace ini.</li></ol>
        <p className="text-sm text-neutral-600">Meta meminta izin profil, publikasi, dan pesan pada jalur ini. Veloxa saat ini menyediakan publikasi konten; fitur pesan belum diaktifkan.</p>
        {!loading && !accounts.instagramLoginAvailable && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">Koneksi Instagram langsung sedang disiapkan. Silakan coba kembali nanti.</p>}
      </div> : <div className="space-y-3">
        <h3 className="font-medium">Hubungkan melalui Facebook</h3>
        <ol className="list-inside list-decimal space-y-1 text-neutral-600"><li>Masuk dengan Facebook dan pilih Page yang Anda kelola.</li><li>Berikan izin untuk Page dan Instagram profesional yang tertaut.</li><li>Pilih akun tujuan di Veloxa, lalu simpan koneksinya.</li></ol>
      </div>}
      <button type="button" disabled={busy || loading || (method === 'instagram' && !accounts.instagramLoginAvailable)} onClick={() => void perform(async () => {
        const result = await veloxaApi<{ url: string }>(method === 'instagram' ? '/api/veloxa/instagram/start' : '/api/veloxa/meta/start', { method: 'POST', body: JSON.stringify({ workspaceId }) });
        window.location.assign(result.url);
      })} className="w-full rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white disabled:opacity-50">{busy ? 'Memproses…' : method === 'instagram' ? 'Lanjutkan dengan Instagram' : 'Lanjutkan dengan Facebook'}</button>
      {method === 'instagram' && (accounts.instagramAccounts?.length || 0) > 0 && <div className="space-y-3 rounded-xl border p-4">
        <label htmlFor="instagram-account" className="block font-medium">Pilih akun Instagram untuk workspace ini</label>
        <select id="instagram-account" value={instagramAccountId} onChange={event => setInstagramAccountId(event.target.value)} disabled={busy || loading} className="w-full rounded-xl border p-3">
          {accounts.instagramAccounts?.map(account => <option key={account.accountId} value={account.accountId}>@{account.username}</option>)}
        </select>
        <button type="button" disabled={busy || loading || !instagramAccountId || !accounts.instagramLoginAvailable} onClick={() => void perform(async () => {
          const result = await veloxaApi<{ connections: ChannelConnectionState[] }>('/api/veloxa/instagram/connection', { method: 'POST', body: JSON.stringify({ workspaceId, accountId: instagramAccountId }) });
          const verified = result.connections.find(connection => connection.channel === 'instagram' && connection.connected);
          if (!verified) throw new Error('Status akun Instagram belum dapat diverifikasi. Muat ulang halaman.');
          onConnections(result.connections); await refresh(); setManaging(false); setMessage(`Instagram ${verified.handle} terhubung. Buat dan tinjau konten di Content Studio.`);
        })} className="w-full rounded-xl bg-[#D85A88] px-5 py-3 font-medium text-white disabled:opacity-50">Gunakan akun Instagram ini</button>
      </div>}
      {method === 'facebook' && accounts.pages.length > 0 && <div className="space-y-3 rounded-xl border p-4">
        <label htmlFor="meta-page" className="block font-medium">Pilih Facebook Page untuk workspace ini</label>
        <select id="meta-page" value={pageId} onChange={event => setPageId(event.target.value)} disabled={busy || loading} className="w-full rounded-xl border p-3">
          {accounts.pages.map(page => <option key={page.pageId} value={page.pageId}>{page.pageName}{page.instagramHandle ? ` · @${page.instagramHandle}` : ' · tanpa Instagram tertaut'}</option>)}
        </select>
        {!selectedPage?.instagramHandle && <p className="text-neutral-600">Page ini belum memiliki Instagram profesional yang tertaut. Anda bisa menghubungkan Instagram secara terpisah melalui pilihan Instagram saja.</p>}
        <button type="button" disabled={busy || loading || !selectedPage} onClick={() => void perform(async () => {
          const result = await veloxaApi<{ connections: ChannelConnectionState[] }>('/api/veloxa/meta/accounts', { method: 'POST', body: JSON.stringify({ workspaceId, pageId }) });
          onConnections(result.connections); await refresh(); setManaging(false); setMessage('Koneksi disimpan. Buat post tunggal, carousel, atau Reels di Content Studio, lalu tinjau sebelum menerbitkan.');
        })} className="w-full rounded-xl bg-[#D85A88] px-5 py-3 font-medium text-white disabled:opacity-50">{selectedPage?.instagramHandle ? 'Gunakan Page dan Instagram ini' : 'Gunakan Facebook Page ini'}</button>
      </div>}
    </div>}
    {accounts.connections.some(item => item.channel === method) && <button type="button" disabled={busy || loading} onClick={() => void perform(async () => {
      await veloxaApi(method === 'instagram' ? '/api/veloxa/instagram/connection' : '/api/veloxa/meta/accounts', { method: 'DELETE', body: JSON.stringify({ workspaceId }) });
      const refreshed = await refresh();
      if (!refreshed) throw new Error('Status koneksi belum dapat dimuat. Muat ulang halaman.');
      onConnections(refreshed.connections); setManaging(false); setMessage(method === 'instagram' ? 'Instagram telah diputus dari workspace ini. Koneksi Facebook tetap dipertahankan.' : 'Facebook dan Instagram telah diputus dari workspace ini.');
    })} className="rounded-xl border border-red-200 px-4 py-2 text-red-700 disabled:opacity-50">{method === 'instagram' ? 'Putuskan koneksi Instagram' : 'Putuskan koneksi Facebook dan Instagram'}</button>}
    <p className="text-sm text-neutral-500">TikTok, YouTube, dan eksekusi iklan belum diaktifkan. Koneksi ini digunakan untuk publikasi konten. Fitur iklan dan pesan belum diaktifkan di Veloxa.</p>
  </section>;
}
