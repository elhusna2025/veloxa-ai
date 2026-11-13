'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Link2, Megaphone, RefreshCw } from 'lucide-react';
import type { BusinessContext } from '@/lib/business-context';
import type { MetaAdsDashboard, MetaAdsExecution } from '@/lib/meta-ads';
import type { ContentDraft, MetaAdCampaignPlan } from '@/lib/veloxa-types';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import { VeloxaSelect } from './VeloxaSelect';

type Action =
  | { action: 'prepare'; plan: MetaAdCampaignPlan; adAccountId: string; connectionId: string }
  | { action: 'activate' | 'pause'; campaign: MetaAdsExecution };

const connectionCopy = {
  connected: 'Akun iklan terhubung',
  disconnected: 'Hubungkan akun iklan Meta untuk menyiapkan kampanye.',
  expired: 'Sesi akun iklan berakhir. Hubungkan kembali untuk melanjutkan.',
  permission_error: 'Akun iklan memerlukan izin pengelolaan iklan di Meta.',
  unavailable: 'Status akun iklan belum tersedia. Coba muat ulang.',
};

const campaignCopy = {
  preparing: 'Menyiapkan di Meta',
  paused: 'Dijeda di Meta',
  activating: 'Mengaktifkan di Meta',
  active: 'Diaktifkan di Meta',
  pausing: 'Menjeda di Meta',
  attention: 'Perlu diperiksa di Meta',
};

const deliveryCopy: Record<string, string> = {
  ACTIVE: 'Sedang tayang',
  PAUSED: 'Dijeda',
  PENDING_REVIEW: 'Dalam peninjauan Meta',
  IN_PROCESS: 'Diproses oleh Meta',
  DISAPPROVED: 'Ditolak Meta',
  WITH_ISSUES: 'Perlu diperiksa di Meta',
};

function CampaignConfirmation({ action, accountName, busy, onCancel, onConfirm }: {
  action: Action;
  accountName?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, locale } = useWorkspaceCopy(workspaceCatalog);
  const ref = useRef<HTMLDialogElement>(null);
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);

  const prepare = action.action === 'prepare';
  const activate = action.action === 'activate';
  const campaign = 'campaign' in action ? action.campaign : undefined;
  const title = prepare ? 'Siapkan kampanye di Meta' : activate ? 'Aktifkan kampanye di Meta' : 'Jeda kampanye di Meta';
  const budget = prepare ? action.plan.budget.totalBudgetIdr : campaign?.totalBudgetIdr;
  const duration = prepare ? action.plan.budget.durationDays : campaign?.durationDays;
  return <dialog ref={ref} aria-labelledby="confirm-meta-campaign-title" className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 backdrop:bg-neutral-900/40 sm:p-6"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && (!prepare || categoryConfirmed)) onConfirm(); }} className="space-y-4">
      <h3 id="confirm-meta-campaign-title" className="text-xl font-semibold">{t(title)}</h3>
      <p className="break-words text-sm text-neutral-600">{accountName || campaign?.adAccountName}</p>
      {prepare && <p className="break-words font-medium">{action.plan.campaignName}</p>}
      {prepare && <p className="text-sm leading-relaxed text-neutral-600">
        {t('Penempatan Facebook. Target berdasarkan lokasi dan usia.')}
        {' '}{action.plan.demographics.locations.map(location => location.cityOrPinName).join(', ')}
        {' · '}{action.plan.demographics.ageMin}–{action.plan.demographics.ageMax}
      </p>}
      {(prepare || activate) && <p className="break-all text-sm text-neutral-600">{prepare ? action.plan.destinationUrlOrWa : campaign?.destinationUrl}</p>}
      {(prepare || activate) && typeof budget === 'number' && <p className="rounded-lg bg-neutral-50 p-3 text-sm">
        {t('Total anggaran')} <strong>{money.format(budget)}</strong> · {duration} {t('hari')}
      </p>}
      <p className="text-sm leading-relaxed text-neutral-600">{t(prepare
        ? 'Meta menerima kampanye dalam status dijeda.'
        : activate ? 'Meta dapat mulai menayangkan iklan dan menagih akun iklan setelah persetujuan Meta.'
          : 'Meta akan menghentikan penayangan setelah jeda diproses.')}</p>
      {prepare && <label className="flex min-h-11 items-start gap-3 rounded-lg border border-neutral-200 p-3 text-sm">
        <input type="checkbox" checked={categoryConfirmed} onChange={event => setCategoryConfirmed(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0 accent-[#a92e5d]" />
        {t('Saya memastikan iklan ini tidak termasuk kategori iklan khusus Meta.')}
      </label>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="veloxa-button-secondary" onClick={onCancel} disabled={busy}>{t('Batal')}</button>
        <button type="submit" className="veloxa-button-primary" disabled={busy || prepare && !categoryConfirmed}>{t(busy ? 'Tunggu proses…' : title)}</button>
      </div>
    </form>
  </dialog>;
}

export function VeloxaMetaCampaigns({ business, plans, drafts, ready, disabled = false, onBusyChange, request = veloxaApi }: {
  business: BusinessContext;
  plans: MetaAdCampaignPlan[];
  drafts: ContentDraft[];
  ready: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  request?: typeof veloxaApi;
}) {
  const { t, locale } = useWorkspaceCopy(workspaceCatalog);
  const [dashboard, setDashboard] = useState<MetaAdsDashboard>();
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Action>();
  const [planId, setPlanId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const inFlight = useRef(false);
  const workspaceId = business.brand.workspaceId;
  const businessId = business.id;
  const endpoint = '/api/veloxa/meta-ads/';
  const query = new URLSearchParams({ workspaceId, businessId }).toString();
  const refresh = useCallback(() => setRevision(current => current + 1), []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void request<MetaAdsDashboard>(`${endpoint}?${query}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setDashboard(result);
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Status akun iklan belum tersedia. Coba muat ulang.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, ready, request, revision]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const campaigns = dashboard?.campaigns ?? [];
  const availablePlans = plans.filter(plan => plan.objective === 'WEBSITE_CONVERSIONS' &&
    !campaigns.some(campaign => campaign.planId === plan.id) &&
    plan.destinationAccounts?.some(account => account.channel === 'facebook') &&
    drafts.some(draft => draft.id === plan.originatedFromOrganicDraftId && draft.format === 'single_post' && draft.renderedMedia));
  const selectedPlan = availablePlans.find(plan => plan.id === planId);
  const accounts = dashboard?.accounts.filter(account => account.eligible) ?? [];
  const identities = dashboard?.identities.filter(identity => selectedPlan?.destinationAccounts?.some(account => account.connectionId === identity.connectionId)) ?? [];
  const currentAccount = accounts.find(account => account.id === adAccountId);
  const currentIdentity = identities.find(identity => identity.connectionId === connectionId);
  const fresh = ready && !disabled && !loading && !loadError;
  const mayChange = fresh && dashboard?.connection === 'connected' && dashboard.canManage;
  const canPrepare = mayChange && dashboard.canPrepare;
  const number = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError('');
    try {
      const { url } = await request<{ url: string }>('/api/veloxa/meta/start/', {
        method: 'POST', body: JSON.stringify({ workspaceId, purpose: 'ads' }),
      });
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.hostname !== 'www.facebook.com' || target.port || target.username || target.password) {
        throw new Error('Tautan koneksi Meta tidak valid.');
      }
      window.location.assign(target.href);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Koneksi iklan belum tersedia.');
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function submit(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError('');
    const details = action.action === 'prepare'
      ? { planId: action.plan.id, adAccountId: action.adAccountId, connectionId: action.connectionId, specialAdCategory: 'NONE' }
      : { planId: action.campaign.planId, confirm: true };
    try {
      const { campaign } = await request<{ campaign: MetaAdsExecution }>(endpoint, {
        method: 'POST', body: JSON.stringify({ workspaceId, businessId, action: action.action, ...details }),
      });
      setDashboard(current => current && { ...current, campaigns: [campaign, ...current.campaigns.filter(item => item.planId !== campaign.planId)] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Periksa status kampanye di Meta sebelum mencoba lagi.');
    } finally {
      setConfirmation(undefined);
      setBusy(false);
      inFlight.current = false;
      refresh();
    }
  }

  return <section className="veloxa-panel space-y-4 p-4 sm:p-6" aria-labelledby="meta-execution-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="meta-execution-title" className="flex items-center gap-2 text-xl font-semibold"><Megaphone size={20} aria-hidden="true" /> {t('Kampanye Meta')}</h2>
        <p className="mt-2 text-sm text-neutral-600">{t('Siapkan rancangan di Meta, lalu tinjau anggaran sebelum mengaktifkan.')}</p></div>
      <button type="button" className="veloxa-button-secondary" disabled={!ready || loading || busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{t('Muat ulang')}</button>
    </div>
    {loading && <p role="status" className="text-sm text-neutral-600">{t('Memeriksa akun iklan dan kampanye…')}</p>}
    {!ready && <p role="status" className="text-sm text-neutral-600">{t('Tunggu data bisnis siap untuk memeriksa akun iklan.')}</p>}
    {loadError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t(loadError)}</p>}
    {dashboard && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3">
      <p className="text-sm font-medium">{t(connectionCopy[dashboard.connection])}</p>
      {dashboard.canManage && dashboard.connection !== 'unavailable' && <button type="button" className="veloxa-button-secondary" disabled={!fresh || busy} onClick={() => void connect()}>
        <Link2 size={16} aria-hidden="true" />{t(dashboard.connection === 'disconnected' ? 'Hubungkan akun iklan' : 'Hubungkan kembali akun iklan')}
      </button>}
    </div>}
    {dashboard?.canManage && !dashboard.canPrepare && <p className="text-sm text-neutral-600">{t('Aktifkan paket Pro untuk membuat kampanye.')}</p>}
    {canPrepare && !accounts.length && <p className="text-sm text-neutral-600">{t('Pilih akun iklan Meta aktif dengan mata uang IDR dan akses kelola kampanye.')}</p>}
    {canPrepare && !!accounts.length && !dashboard.identities.length && <p className="text-sm text-neutral-600">{t('Tautkan Halaman Facebook yang bisa Anda kelola ke bisnis ini.')}</p>}
    {canPrepare && !!accounts.length && !!dashboard.identities.length && <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <h3 className="font-semibold">{t('Siapkan dari rancangan')}</h3>
      <p className="text-sm text-neutral-600">{t('Gunakan tujuan kunjungan website, post satu gambar dari Studio, dan Halaman Facebook bisnis aktif.')}</p>
      <p className="text-sm text-neutral-600">{t('Kampanye ini memakai lokasi dan usia. Minat dari rancangan belum digunakan untuk penayangan.')}</p>
      {availablePlans.length ? <>
        <div className="grid gap-3 lg:grid-cols-3">
          <div><label htmlFor="meta-launch-plan" className="mb-2 block text-sm font-medium">{t('Rancangan iklan')}</label>
            <VeloxaSelect id="meta-launch-plan" value={selectedPlan?.id ?? ''} disabled={busy} onValueChange={id => { setPlanId(id); setConnectionId(''); }} placeholder={t('Pilih rancangan…')}>
              {availablePlans.map(plan => <option key={plan.id} value={plan.id}>{plan.campaignName}</option>)}
            </VeloxaSelect></div>
          <div><label htmlFor="meta-launch-account" className="mb-2 block text-sm font-medium">{t('Akun iklan')}</label>
            <VeloxaSelect id="meta-launch-account" value={currentAccount?.id ?? ''} disabled={busy} onValueChange={setAdAccountId} placeholder={t('Pilih akun iklan…')}>
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </VeloxaSelect></div>
          <div><label htmlFor="meta-launch-page" className="mb-2 block text-sm font-medium">{t('Halaman Facebook')}</label>
            <VeloxaSelect id="meta-launch-page" value={currentIdentity?.connectionId ?? ''} disabled={busy || !selectedPlan} onValueChange={setConnectionId} placeholder={t('Pilih Halaman…')}>
              {identities.map(identity => <option key={identity.connectionId} value={identity.connectionId}>{identity.name}</option>)}
            </VeloxaSelect></div>
        </div>
        {selectedPlan && !identities.length && <p className="text-sm text-neutral-600">{t('Rancangan ini memerlukan Halaman Facebook yang bisa Anda kelola.')}</p>}
        <button type="button" className="veloxa-button-primary" disabled={busy || !selectedPlan || !currentAccount || !currentIdentity} onClick={() => {
          if (selectedPlan && currentAccount && currentIdentity) setConfirmation({ action: 'prepare', plan: selectedPlan, adAccountId: currentAccount.id, connectionId: currentIdentity.connectionId });
        }}>{t('Tinjau kampanye')}</button>
      </> : <p className="text-sm text-neutral-600">{t('Simpan rancangan yang memenuhi syarat untuk menyiapkan kampanye.')}</p>}
    </div>}
    {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t(actionError)}</p>}
    {!!campaigns.length && <ul className="space-y-3" aria-label={t('Status kampanye')}>
      {campaigns.map(campaign => <li key={campaign.planId} className="space-y-3 rounded-lg border border-neutral-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-semibold">{campaign.title || plans.find(plan => plan.id === campaign.planId)?.campaignName || t('Kampanye Meta')}</h3>
          <p className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium">{t(campaignCopy[campaign.status])}</p>
        </div>
        {campaign.adAccountName && <p className="break-words text-sm text-neutral-600">{campaign.adAccountName}</p>}
        {campaign.effectiveStatus && deliveryCopy[campaign.effectiveStatus] && <p className="text-sm text-neutral-600">{t(deliveryCopy[campaign.effectiveStatus])}</p>}
        {typeof campaign.totalBudgetIdr === 'number' && <p className="text-sm">{t('Total anggaran')} {money.format(campaign.totalBudgetIdr)} · {number.format(campaign.durationDays ?? 0)} {t('hari')}</p>}
        {campaign.message && <p className="text-sm leading-relaxed text-neutral-600">{t(campaign.message)}</p>}
        {campaign.insights && <dl className="grid gap-3 rounded-lg bg-neutral-50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-neutral-600">{t('Pengeluaran')}</dt><dd className="font-medium">{money.format(campaign.insights.spendIdr)}</dd></div>
          <div><dt className="text-neutral-600">{t('Tayangan')}</dt><dd className="font-medium">{number.format(campaign.insights.impressions)}</dd></div>
          <div><dt className="text-neutral-600">{t('Klik')}</dt><dd className="font-medium">{number.format(campaign.insights.clicks)}</dd></div>
        </dl>}
        <div className="flex flex-wrap gap-2">
          {mayChange && dashboard.canPrepare && campaign.status === 'paused' && (campaign.endsAt === undefined || campaign.endsAt > Date.now()) && <button type="button" className="veloxa-button-primary" disabled={busy} onClick={() => setConfirmation({ action: 'activate', campaign })}>{t('Tinjau dan aktifkan')}</button>}
          {fresh && dashboard?.canManage && campaign.campaignId && (campaign.status === 'active' || campaign.status === 'attention') && <button type="button" className="veloxa-button-secondary" disabled={busy} onClick={() => setConfirmation({ action: 'pause', campaign })}>{t('Jeda kampanye')}</button>}
          {campaign.campaignId && /^\d+$/.test(campaign.campaignId) && /^\d+$/.test(campaign.adAccountId.replace(/^act_/, '')) && <a className="veloxa-button-secondary" href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${campaign.adAccountId.replace(/^act_/, '')}&selected_campaign_ids=${campaign.campaignId}`} target="_blank" rel="noreferrer">
            {t('Buka Ads Manager')}<ArrowUpRight size={16} aria-hidden="true" />
          </a>}
        </div>
      </li>)}
    </ul>}
    {confirmation && <CampaignConfirmation action={confirmation} accountName={confirmation.action === 'prepare' ? currentAccount?.name : undefined} busy={busy} onCancel={() => setConfirmation(undefined)} onConfirm={() => void submit(confirmation)} />}
  </section>;
}
