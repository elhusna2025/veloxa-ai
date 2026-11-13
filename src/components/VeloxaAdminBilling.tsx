'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import { billingStates, formatBillingDate, formatBillingIdr, invoiceStates, type AdminBillingDetail, type AdminBillingList, type BillingInvoice } from '@/lib/billing';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import styles from './VeloxaSuperAdmin.module.css';

const endpoint = '/api/veloxa/admin/billing/';
const modeLabel = { disabled: 'Pembayaran belum tersedia', sandbox: 'Uji coba Duitku', production: 'Pembayaran Duitku' };

export function VeloxaAdminBilling({ request = veloxaApi }: { request?: typeof veloxaApi }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: AdminBillingList | AdminBillingDetail; error?: string }>();
  const [action, setAction] = useState<{ workspace: string; invoiceId: string; busy: boolean; error?: string }>();
  const cursor = cursors.at(-1);
  const path = workspace ? `${endpoint}?workspaceId=${encodeURIComponent(workspace)}` : cursor ? `${endpoint}?cursor=${encodeURIComponent(cursor)}` : endpoint;
  const key = `${path}:${revision}`;
  const current = result?.key === key ? result : undefined;
  const busy = action?.workspace === workspace && action.busy;
  const detail = current?.data && 'costs' in current.data ? current.data : undefined;
  const list = current?.data && 'workspaces' in current.data ? current.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void request<AdminBillingList | AdminBillingDetail>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setResult({ key, data }); },
      error => { if (!controller.signal.aborted) setResult({ key, error: error.message || 'Tagihan belum dapat dimuat.' }); },
    );
    return () => controller.abort();
  }, [key, path, request]);

  function refresh() {
    setRevision(value => value + 1);
  }

  async function checkInvoice(invoice: BillingInvoice) {
    if (!workspace || busy) return;
    setAction({ workspace, invoiceId: invoice.id, busy: true });
    try {
      await request(endpoint, { method: 'PATCH', body: JSON.stringify({ workspaceId: workspace, invoiceId: invoice.id }) });
      setAction({ workspace, invoiceId: invoice.id, busy: false });
      refresh();
    } catch (error) {
      setAction({ workspace, invoiceId: invoice.id, busy: false, error: error instanceof Error ? error.message : 'Status belum diperbarui.' });
    }
  }

  return <section className={styles.stack} aria-labelledby="admin-billing-title">
    <header className={styles.heading}>
      <div>
        {workspace && <button type="button" onClick={() => { setWorkspace(null); setAction(undefined); }} className={styles.link} disabled={busy}><ArrowLeft size={16} /> Kembali ke langganan</button>}
        <h2 id="admin-billing-title">{detail?.workspace.name || 'Paket dan pembayaran'}</h2>
        <p>{detail ? 'Paket, pemakaian kuota, dan tagihan workspace.' : 'Pantau paket dan pembayaran per workspace.'}</p>
      </div>
      <button className={styles.button} type="button" onClick={refresh} disabled={!current || busy}><RefreshCw size={16} aria-hidden="true" /> Muat ulang</button>
    </header>
    {!current && <p role="status" className={styles.note}>Memuat data langganan…</p>}
    {current?.error && <p className={styles.error} role="alert">{current.error}</p>}
    {list && <div className={styles.panel}>
      <p className={styles.meta}>{modeLabel[list.mode]}</p>
      {list.workspaces.length ? <ul className={styles.list}>
        {list.workspaces.map(item => <li key={item.id}>
          <div><strong>{item.name}</strong><span className={styles.meta}>{SUBSCRIPTION_PLANS[item.planId].name} · {billingStates[item.state]}</span></div>
          <button type="button" className={styles.button} onClick={() => setWorkspace(item.id)}>Lihat tagihan<span className="sr-only"> {item.name}</span></button>
        </li>)}
      </ul> : <p className={styles.empty}>Belum ada workspace di halaman ini.</p>}
      {(cursor || list.nextCursor) && <div className={`${styles.rowActions} mt-3`}>
        <button type="button" className={styles.button} disabled={!cursor} onClick={() => setCursors(value => value.slice(0, -1))}><ArrowLeft size={16} /> Sebelumnya</button>
        <button type="button" className={styles.button} disabled={!list.nextCursor} onClick={() => { if (list.nextCursor) setCursors(value => [...value, list.nextCursor!]); }}>Berikutnya <ArrowRight size={16} /></button>
      </div>}
    </div>}
    {detail && <>
      <div className={styles.panel}>
        <h2>{SUBSCRIPTION_PLANS[detail.workspace.planId].name}</h2>
        <p className={styles.meta}>{billingStates[detail.workspace.state]}{detail.workspace.paidUntil && ` · Hingga ${formatBillingDate(detail.workspace.paidUntil)}`}</p>
        <dl className={styles.quota}>
          <div><dt>Publikasi bulan ini</dt><dd>{detail.publication.used} / {detail.publication.limit}</dd></div>
          <div><dt>Pembuatan draf hari ini</dt><dd>{detail.generation.used} / {detail.generation.dailyLimit ?? 'Tanpa batas'}</dd></div>
        </dl>
      </div>
      <div className={styles.panel}>
        <h2>Biaya dan pembayaran</h2><p className={styles.meta}>{detail.costs.month} · WIB</p>
        <dl className={styles.quota}>
          <div><dt>Estimasi biaya AI</dt><dd>{formatBillingIdr(detail.costs.estimatedAiIdr)}</dd></div>
          <div><dt>Pembayaran terverifikasi</dt><dd>{formatBillingIdr(detail.costs.paidIdr)}</dd></div>
        </dl>
        <p className={styles.description}>Estimasi memakai {detail.costs.savedDrafts} draf tersimpan bulan ini dan tarif perkiraan paket saat ini. Total pembayaran mencakup transaksi produksi.</p>
        {detail.costs.reviewInvoices > 0 && <p role="status" className={styles.note}>{detail.costs.reviewInvoices} pembayaran terverifikasi menunggu pemeriksaan paket.</p>}
      </div>
      <div className={styles.panel}>
        <h2>Riwayat tagihan</h2><p className={styles.meta}>{modeLabel[detail.mode]} · 20 tagihan terakhir</p>
        {detail.invoices.length ? <ul className={styles.list}>
          {detail.invoices.map(invoice => <li key={invoice.id}>
            <div>
              <strong>{SUBSCRIPTION_PLANS[invoice.planId].name} · {formatBillingIdr(invoice.amountIdr)}</strong>
              <span className={styles.meta}>{invoiceStates[invoice.state]}{invoice.mode === 'sandbox' && ' · Uji coba'}</span>
              <span className={styles.meta}>{formatBillingDate(invoice.createdAt)} · {invoice.id}</span>
              {invoice.paidAt && <span className={styles.meta}>Pembayaran terverifikasi pada {formatBillingDate(invoice.paidAt)}</span>}
              {action?.workspace === workspace && action?.invoiceId === invoice.id && action?.error && <p role="alert" className={styles.error}>{action.error}</p>}
            </div>
            {invoice.canCheck && <button className={styles.button} disabled={busy} type="button" onClick={() => void checkInvoice(invoice)}>
              {busy && action?.invoiceId === invoice.id ? 'Memeriksa…' : 'Periksa status'}
            </button>}
          </li>)}
        </ul> : <p className={styles.empty}>Belum ada tagihan.</p>}
      </div>
    </>}
  </section>;
}
