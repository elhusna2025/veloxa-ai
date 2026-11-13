'use client';

import { useEffect, useState } from 'react';
import type { AdminIntegrationStatus } from '@/lib/admin-integrations';
import type { AdminWorkspace, AdminWorkspacePage } from '@/lib/admin-operations';
import { veloxaApi } from '@/lib/veloxa-api-client';
import styles from './VeloxaSuperAdmin.module.css';

const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const number = new Intl.NumberFormat('id-ID');
const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const adsStatus = { connected: 'Izin tercatat', disconnected: 'Belum terhubung', expired: 'Izin berakhir', permission_error: 'Izin belum lengkap' };
const campaignStatus = { preparing: 'Disiapkan', paused: 'Dijeda', activating: 'Diaktifkan', active: 'Aktif', pausing: 'Sedang dijeda', attention: 'Perlu diperiksa' };

export function VeloxaAdminIntegrations({ request = veloxaApi }: { request?: typeof veloxaApi }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0);
  const [workspace, setWorkspace] = useState<AdminWorkspace>();
  const [list, setList] = useState<AdminWorkspacePage>();
  const [data, setData] = useState<AdminIntegrationStatus>();
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setList(undefined);
    setListError('');
    const params = new URLSearchParams({ view: 'workspaces', ...(filter && { q: filter }), ...(cursor && { cursor }) });
    void request<AdminWorkspacePage>(`/api/veloxa/admin/?${params}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setList(value);
    }).catch(error => {
      if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : 'Daftar workspace belum tersedia.');
    });
    return () => controller.abort();
  }, [request, filter, cursor]);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    setData(undefined);
    setDetailError('');
    void request<AdminIntegrationStatus>(`/api/veloxa/admin/integrations/?${new URLSearchParams({ workspaceId: workspace.id })}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(error => {
      if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : 'Integrasi belum tersedia.');
    });
    return () => controller.abort();
  }, [request, workspace, revision]);

  return <div className={styles.stack}>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); setFilter(query.trim()); setCursor(undefined); setHistory([]); }}>
      <div><label htmlFor="integrations-workspace-query">Cari workspace</label><input id="integrations-workspace-query" type="search" value={query} onChange={event => setQuery(event.target.value)} maxLength={110} /></div>
      <button type="submit" className={styles.primary}>Cari</button>
    </form>
    {listError && <p role="alert" className={styles.error}>{listError}</p>}
    {!list && !listError && <p role="status" className={styles.empty}>Memuat workspace…</p>}
    {list && <section className={styles.panel} aria-labelledby="integration-workspaces-title">
      <h2 id="integration-workspaces-title">Workspace</h2>
      {list.items.length ? <ul className={styles.list}>{list.items.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><span className={styles.meta}>{item.plan}</span></div>
        <button type="button" className={styles.button} aria-pressed={workspace?.id === item.id} onClick={() => { setData(undefined); setWorkspace(item); setRevision(current => current + 1); }}>
          Periksa integrasi<span className="sr-only"> {item.name}</span>
        </button>
      </li>)}</ul> : <p className={styles.empty}>Tidak ada workspace yang cocok.</p>}
      {(history.length > 0 || list.cursor) && <div className={styles.rowActions}>
        <button type="button" className={styles.button} disabled={!history.length} onClick={() => { setCursor(history.at(-1)); setHistory(current => current.slice(0, -1)); }}>Sebelumnya</button>
        <button type="button" className={styles.button} disabled={!list.cursor} onClick={() => { setHistory(current => [...current, cursor]); setCursor(list.cursor ?? undefined); }}>Berikutnya</button>
      </div>}
    </section>}
    {workspace && <section className={styles.panel} aria-labelledby="integration-status-title">
      <div className={styles.heading}>
        <h2 id="integration-status-title">Integrasi {workspace.name}</h2>
        <button type="button" className={styles.button} disabled={!data && !detailError} onClick={() => setRevision(current => current + 1)}>Perbarui status</button>
      </div>
      {!data && !detailError && <p role="status" className={styles.empty}>Memuat integrasi…</p>}
      {detailError && <p role="alert" className={styles.error}>{detailError}</p>}
      {data && <div className={styles.stack}>
        <ul className={styles.list} aria-label="Status akun Meta">
          <li><div><strong>Akun iklan Meta</strong><span className={styles.meta}>{data.advertising.expiresAt ? `Masa berlaku hingga ${date.format(data.advertising.expiresAt)} WIB` : 'Status izin tersimpan di Veloxa'}</span></div>
            <span className={styles.badge} data-tone={data.advertising.status === 'connected' ? 'good' : 'warn'}>{adsStatus[data.advertising.status]}</span></li>
          {data.accounts.map(account => {
            const expired = account.expiresAt !== null && account.expiresAt <= Date.now();
            return <li key={account.id}>
              <div><strong>{account.label}</strong><span className={styles.meta}>{account.channel === 'facebook' ? 'Facebook' : 'Instagram'} · {account.business ?? 'Belum ditautkan ke bisnis'}</span></div>
              <span className={styles.badge} data-tone={expired ? 'warn' : 'good'}>{expired ? 'Izin berakhir' : 'Izin tercatat'}</span>
            </li>;
          })}
        </ul>
        <div><h3>Kampanye terakhir</h3>
          {data.campaigns.length ? <ul className={styles.list}>{data.campaigns.map(campaign => <li key={campaign.id}>
            <div>
              <strong>{campaign.title}</strong>
              <span className={styles.meta}>{campaign.business} · {campaign.accountName} · {money.format(campaign.totalBudgetIdr)}</span>
              <span className={styles.meta}>Diperbarui {date.format(campaign.updatedAt)} WIB</span>
              {campaign.insights && <span className={styles.meta}>{money.format(campaign.insights.spendIdr)} terpakai · {number.format(campaign.insights.impressions)} tayangan · {number.format(campaign.insights.clicks)} klik</span>}
            </div>
            <span className={styles.badge} data-tone={campaign.status === 'attention' ? 'warn' : campaign.status === 'active' ? 'good' : undefined}>{campaignStatus[campaign.status]}</span>
          </li>)}</ul> : <p className={styles.empty}>Belum ada kampanye tersimpan.</p>}
        </div>
      </div>}
    </section>}
  </div>;
}
