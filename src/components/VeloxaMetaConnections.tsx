'use client';
import { useCallback, useEffect, useState } from 'react';
import { veloxaApi } from '@/lib/veloxa-api-client';
import type { ChannelConnectionState } from '@/lib/veloxa-types';

type Accounts = { pages: { pageId: string; pageName: string; instagramHandle: string }[]; connections: ChannelConnectionState[] };
export function VeloxaMetaConnections({ workspaceId, onConnections }: { workspaceId: string; onConnections: (connections: ChannelConnectionState[]) => void }) {
  const [accounts, setAccounts] = useState<Accounts>({ pages: [], connections: [] });
  const [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setError('');
      const result = await veloxaApi<Accounts>(`/api/veloxa/meta/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
      setAccounts(result); setPageId(current => result.pages.some(page => page.pageId === current) ? current : result.connections.find(connection => connection.channel === 'facebook')?.handle || result.pages[0]?.pageId || '');
    } catch (err) { setError(err instanceof Error ? err.message : 'Status koneksi belum dapat dimuat.'); }
  }, [workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Koneksi belum berhasil.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 space-y-4 text-sm" aria-label="Koneksi resmi Meta">
    <p className="text-neutral-600">Hubungkan Facebook Page yang Anda kelola. Instagram harus berupa akun Business atau Creator yang ditautkan ke Page tersebut. Veloxa meminta izin melalui Meta dan tidak meminta password akun sosial Anda.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <ul className="space-y-2">{accounts.connections.map(connection => <li key={connection.channel} className="rounded-xl border p-3"><strong>{connection.channel === 'facebook' ? 'Facebook Page' : 'Instagram'}</strong> · {connection.accountName} — {connection.connected ? 'Terhubung' : 'Perlu dihubungkan ulang'}</li>)}</ul>
    <button type="button" disabled={busy} onClick={() => void perform(async () => {
      const result = await veloxaApi<{ url: string }>('/api/veloxa/meta/start', { method: 'POST', body: JSON.stringify({ workspaceId }) });
      window.location.assign(result.url);
    })} className="w-full rounded-xl bg-neutral-900 px-5 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Memproses…' : 'Lanjutkan ke Facebook untuk memberikan izin'}</button>
    {accounts.pages.length > 0 && <div className="space-y-3 rounded-xl border p-4">
      <label htmlFor="meta-page" className="block font-bold">Pilih Page untuk workspace ini</label>
      <select id="meta-page" value={pageId} onChange={event => setPageId(event.target.value)} disabled={busy} className="w-full rounded-xl border p-3">
        {accounts.pages.map(page => <option key={page.pageId} value={page.pageId}>{page.pageName}{page.instagramHandle ? ` · @${page.instagramHandle}` : ' · belum ada Instagram profesional'}</option>)}
      </select>
      <button type="button" disabled={busy || !pageId} onClick={() => void perform(async () => {
        const result = await veloxaApi<{ connections: ChannelConnectionState[] }>('/api/veloxa/meta/accounts', { method: 'POST', body: JSON.stringify({ workspaceId, pageId }) });
        onConnections(result.connections); await refresh(); setMessage('Koneksi disimpan. Buat post tunggal di Studio, lalu tinjau sebelum menerbitkan.');
      })} className="w-full rounded-xl bg-[#D85A88] px-5 py-3 font-bold text-white disabled:opacity-50">Gunakan Page dan Instagram ini</button>
    </div>}
    {accounts.connections.length > 0 && <button type="button" disabled={busy} onClick={() => void perform(async () => {
      await veloxaApi('/api/veloxa/meta/accounts', { method: 'DELETE', body: JSON.stringify({ workspaceId }) });
      onConnections([]); await refresh(); setMessage('Facebook dan Instagram telah diputus dari workspace ini.');
    })} className="rounded-xl border border-red-200 px-4 py-2 text-red-700 disabled:opacity-50">Putuskan koneksi Meta</button>}
    <p className="text-xs text-neutral-500">TikTok, YouTube, dan eksekusi iklan belum diaktifkan. Akun tidak akan ditandai terhubung hanya berdasarkan username.</p>
  </section>;
}
