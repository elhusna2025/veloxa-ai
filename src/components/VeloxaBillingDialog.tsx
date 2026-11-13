'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { billingStates, formatBillingDate, formatBillingIdr, invoiceStates, PAID_ACCESS_DAYS, type BillingInvoice, type WorkspaceBilling } from '@/lib/billing';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import type { SubscriptionPlanId } from '@/lib/veloxa-types';

const endpoint = '/api/veloxa/billing/';

export function VeloxaBillingDialog({ workspaceId, open, onClose, onPlan, request = veloxaApi }: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onPlan?: (data: WorkspaceBilling) => void;
  request?: typeof veloxaApi;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const onPlanRef = useRef(onPlan);
  onPlanRef.current = onPlan;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: WorkspaceBilling; error?: string }>();
  const [selected, setSelected] = useState<SubscriptionPlanId | null>(null);
  const [action, setAction] = useState<{ busy: boolean; error?: string }>();
  const key = `${workspaceId}:${revision}`;
  const current = result?.key === key ? result : undefined;
  const data = current?.data;
  const busy = action?.busy === true;
  const selection = selected || data?.workspace.planId || 'free_trial';
  const canSelect = data?.canPay && !data.checkoutPending && !busy;
  const canBuy = canSelect && selection !== 'free_trial' && (data.mode === 'sandbox' || data.workspace.state === 'trial' || data.workspace.state === 'expired' || data.workspace.state === 'active' && selection === data.workspace.planId);

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    }
    if (!open && element?.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const controller = new AbortController();
    void request<WorkspaceBilling>(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setResult({ key, data });
      onPlanRef.current?.(data);
    }, error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Tagihan belum dapat dimuat.' });
    });
    return () => controller.abort();
  }, [key, open, request, workspaceId]);

  async function updateInvoice(invoice?: BillingInvoice) {
    if (busy || !invoice && !canBuy) return;
    setAction({ busy: true });
    try {
      const response = await request<{ invoice: BillingInvoice }>(endpoint, { method: invoice ? 'PATCH' : 'POST',
        body: JSON.stringify(invoice ? { workspaceId, invoiceId: invoice.id } : { workspaceId, planId: selection }) });
      setAction({ busy: false });
      setRevision(value => value + 1);
      if (!invoice && response.invoice.paymentUrl && dialog.current?.open) window.location.assign(response.invoice.paymentUrl);
    } catch (error) {
      setAction({ busy: false, error: error instanceof Error ? error.message : 'Tagihan belum dapat diperbarui.' });
      setRevision(value => value + 1);
    }
  }

  return <dialog ref={dialog} aria-labelledby="billing-dialog-title" data-testid="billing-checkout-dialog"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClose={() => { if (opener.current?.isConnected) opener.current.focus(); setSelected(null); setAction(undefined); }}
    className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto break-words rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-xl backdrop:bg-black/40 sm:p-6">
    <header className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-4">
      <div><h2 id="billing-dialog-title" className="text-xl font-semibold">Paket dan tagihan</h2>
        {data && <p className="mt-1 text-sm text-neutral-600">{data.workspace.name}</p>}
      </div>
      <button type="button" onClick={onClose} disabled={busy} className="veloxa-button-secondary min-h-11" aria-label="Tutup tagihan"><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="mt-5 space-y-5">
      {!current && <p role="status" className="text-neutral-600">Memuat paket dan tagihan…</p>}
      {current?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{current.error}</p>}
      {action?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{action.error}</p>}
      {data && <>
        <section aria-label="Paket saat ini" className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="text-base font-semibold">{SUBSCRIPTION_PLANS[data.workspace.planId].name}</h3>
          <p className="mt-1 text-sm text-neutral-600">{billingStates[data.workspace.state]}{data.workspace.paidUntil && ` · Hingga ${formatBillingDate(data.workspace.paidUntil)}`}</p>
          <p className="mt-2 text-sm">{data.publication.used} dari {data.publication.limit} publikasi bulan ini</p>
        </section>
        <section aria-labelledby="billing-plans-title">
          <h3 id="billing-plans-title" className="text-lg font-semibold">Pilih paket</h3>
          <p className="mb-3 mt-1 text-sm text-neutral-600">{data.mode === 'disabled' ? 'Pembayaran belum tersedia.' : data.mode === 'sandbox' ? 'Pembayaran uji coba tidak mengaktifkan paket.' : `Paket berbayar berlaku selama ${PAID_ACCESS_DAYS} hari dengan perpanjangan manual.`}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.plans.map(item => {
              const plan = SUBSCRIPTION_PLANS[item.id];
              return <button type="button" key={plan.id} data-testid={`select-plan-btn-${plan.id}`} aria-pressed={selection === plan.id} disabled={!canSelect}
                onClick={() => setSelected(plan.id)} className={`rounded-lg border p-4 text-left ${selection === plan.id ? 'border-[#bd416e] bg-[#faf2f5]' : 'border-neutral-200 bg-white'}`}>
                <strong>{plan.name}</strong><p className="mt-1 text-base">{formatBillingIdr(plan.priceMonthlyIdr)}{plan.priceMonthlyIdr > 0 && ` / ${PAID_ACCESS_DAYS} hari`}</p>
                <p className="mt-1 text-sm text-neutral-600">{item.publicationLimit} publikasi per bulan</p>
              </button>;
            })}
          </div>
          {data.mode === 'production' && data.workspace.state === 'active' && selection !== data.workspace.planId && <p className="mt-2 text-sm text-neutral-600">Pergantian paket tersedia setelah masa aktif berakhir.</p>}
          {data.checkoutPending && <p className="mt-2 text-sm text-neutral-600">Periksa tagihan yang masih berjalan sebelum membuat tagihan baru.</p>}
        </section>
        <section aria-labelledby="billing-invoices-title">
          <h3 id="billing-invoices-title" className="text-lg font-semibold">Riwayat tagihan</h3>
          {data.invoices.length ? <ul className="mt-2 space-y-2">
            {data.invoices.map(invoice => <li key={invoice.id} className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <strong>{SUBSCRIPTION_PLANS[invoice.planId].name} · {formatBillingIdr(invoice.amountIdr)}</strong>
              <p className="text-sm text-neutral-600">{invoiceStates[invoice.state]}{invoice.mode === 'sandbox' && ' · Uji coba'} · {formatBillingDate(invoice.createdAt)}</p>
              {invoice.paidUntil && <p className="text-sm">Paket berlaku hingga {formatBillingDate(invoice.paidUntil)}</p>}
              {invoice.state === 'pending' && <p className="text-sm">Tautan berlaku hingga {formatBillingDate(invoice.expiresAt)}</p>}
              <div className="flex flex-wrap gap-2">
                {invoice.paymentUrl && !busy && <a href={invoice.paymentUrl} className="veloxa-button-primary">Buka Duitku</a>}
                {invoice.canCheck && <button type="button" disabled={busy} className="veloxa-button-secondary" onClick={() => void updateInvoice(invoice)}>Periksa pembayaran</button>}
              </div>
            </li>)}
          </ul> : <p className="mt-2 text-sm text-neutral-600">Belum ada tagihan.</p>}
        </section>
      </>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-4">
        <button type="button" className="veloxa-button-secondary" disabled={!current || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> Muat ulang</button>
        <button type="button" className="veloxa-button-primary" disabled={!canBuy} data-testid="confirm-qris-payment-btn" onClick={() => void updateInvoice()}>
          {busy ? 'Memproses…' : data?.mode === 'disabled' ? 'Pembayaran belum tersedia' : 'Buat tagihan Duitku'}
        </button>
      </div>
    </div>
  </dialog>;
}
