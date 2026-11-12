'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowRight, Building2, CircleAlert, Pause, RefreshCw, Send, X } from 'lucide-react';
import type { AdminJob, AdminOperations, AdminOverview, AdminRule, AdminWorkspaceDetail, AdminWorkspacePage } from '@/lib/admin-operations';
import { veloxaApi } from '@/lib/veloxa-api-client';
import type { AdminSettingsView } from '@/lib/admin-settings';
import { VeloxaAdminSettings } from './VeloxaAdminSettings';
import styles from './VeloxaSuperAdmin.module.css';

type View = 'overview' | 'workspaces' | 'workspace' | 'operations' | 'settings' | 'workspaceSettings';
type Filter = 'all' | 'attention' | 'recovery';
type AdminData = AdminOverview | AdminOperations | AdminWorkspacePage | AdminWorkspaceDetail | AdminSettingsView;
type AdminRequest = <T>(url: string, init?: RequestInit) => Promise<T>;
const endpoint = '/api/veloxa/admin/';
const settingsEndpoint = endpoint + 'settings/';
const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const number = new Intl.NumberFormat('id-ID');
const stamp = (at: number | null) => at ? dateTime.format(at) + ' WIB' : '—';
const ruleKey = (rule: AdminRule) => rule.workspaceId + '/' + rule.businessId;
const states: Record<string, [string, string]> = {
  generating: ['Membuat draf','info'], prepared: ['Draf siap','info'], publishing: ['Mengirim ke akun','info'],
  queued: ['Dalam antrean kirim','info'], retry_generation: ['Akan membuat ulang','warn'], retry_publication: ['Akan mencoba kirim lagi','warn'],
  published: ['Terbit','good'], failed: ['Gagal','bad'], needs_attention: ['Periksa hasil','bad'],
  reconciling: ['Sedang dikonfirmasi','info'],
  cancelled: ['Dibatalkan','muted'], skipped: ['Slot terlewat','warn'], unknown: ['Belum pasti','bad'],
};
const formats: Record<string,string> = { single_post: 'Post tunggal', single_image: 'Post tunggal', carousel: 'Carousel', short_video: 'Reels' };
const channelName = (channel: string) => channel === 'instagram' ? 'Instagram' : 'Facebook';

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}
function RuleBadge({ rule }: { rule: AdminRule }) {
  if (rule.reconciling) return <Badge tone="info">Sedang dikonfirmasi</Badge>;
  return rule.processing ? <Badge tone="info">{rule.enabled ? 'Sedang diproses' : 'Sedang menjeda'}</Badge>
    : rule.issue ? <Badge tone="bad">Perlu diperiksa</Badge>
      : rule.enabled ? <Badge tone="good">Aktif</Badge> : <Badge tone="muted">Tidak aktif</Badge>;
}

function JobList({ jobs, pause, empty = 'Belum ada aktivitas untuk pilihan ini.' }: { jobs: AdminJob[]; pause: (rule: AdminRule) => void; empty?: string }) {
  if (!jobs.length) return <p className={styles.empty}>{empty}</p>;
  return <div className={styles.jobs}>{jobs.map(job => {
    const [label, tone] = states[job.state] || ['Status belum diketahui','muted'];
    return <details key={ruleKey(job.rule) + '/' + job.id} className={styles.job}>
      <summary>
        <span className={styles.jobName}><strong>{job.rule.businessName}</strong><span className={styles.meta}>{[formats[job.format || ''], stamp(job.scheduledAt)].filter(Boolean).join(' · ')}</span></span>
        <Badge tone={tone}>{label}</Badge>
      </summary>
      <div className={styles.jobDetail}>
        <dl className={styles.jobFacts}>
          <div><dt>Workspace</dt><dd>{job.rule.workspaceName}</dd></div>
          <div><dt>Percobaan membuat draf</dt><dd>{job.generationAttempts ?? '—'}</dd></div>
          <div><dt>Putaran pengiriman</dt><dd>{job.publicationAttempts ?? '—'}</dd></div>
          {job.retryAt && <div><dt>{job.state === 'queued' ? 'Lanjutkan antrean' : 'Percobaan berikutnya'}</dt><dd>{stamp(job.retryAt)}</dd></div>}
        </dl>
        {job.state === 'reconciling' && <p className={styles.note}>Veloxa sedang memeriksa hasil di akun tujuan.</p>}
        {job.state === 'needs_attention' && <p className={styles.note}>Periksa kiriman di akun tujuan sebelum mengulang. Kiriman yang belum pasti bisa saja sudah diterima.</p>}
        {job.receipts.length ? <ul className={styles.receipts}>{job.receipts.map((receipt, i) => {
          const [text, color] = states[receipt.status] || states.unknown;
          return <li key={i}>
            <span>{channelName(receipt.channel)} · {receipt.account}</span>
            <Badge tone={color}>{text}</Badge>
            {receipt.permalink && <a href={receipt.permalink} target="_blank" rel="noreferrer">Lihat kiriman</a>}
          </li>;
        })}</ul> : <p className={styles.meta}>Belum ada hasil kirim per akun yang tercatat.</p>}
        {job.rule.enabled && <button className={styles.button} type="button" onClick={() => pause(job.rule)}><Pause size={16} /> Jeda aturan</button>}
      </div>
    </details>;
  })}</div>;
}

function RuleList({ rules, open, pause, empty }: { rules: AdminRule[]; open: (id: string) => void; pause?: (rule: AdminRule) => void; empty: string }) {
  if (!rules.length) return <p className={styles.empty}>{empty}</p>;
  return <ul className={styles.list}>{rules.map(rule => <li key={ruleKey(rule)}>
    <div>
      <strong>{rule.businessName}</strong>
      {rule.workspaceName !== rule.businessName && <span className={styles.meta}>{rule.workspaceName}</span>}
      {rule.enabled && rule.nextSlot && <span className={styles.meta}>{stamp(rule.nextSlot)}</span>}
      {rule.issue && <span className={styles.meta}>{rule.issue}</span>}
    </div>
    <div className={styles.rowActions}>
      <RuleBadge rule={rule} />
      <button className={styles.button} type="button" onClick={() => open(rule.workspaceId)}>Detail<span className="sr-only"> {rule.businessName}</span></button>
      {rule.enabled && pause && <button className={styles.button} type="button" onClick={() => pause(rule)}>Jeda aturan<span className="sr-only"> {rule.businessName}</span></button>}
    </div>
  </li>)}</ul>;
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className={styles.panel}><h2>{title}</h2>{hint && <p className={styles.description}>{hint}</p>}{children}</section>;
}

function Scheduler({ status }: { status: AdminOverview['scheduler'] }) {
  return <div className={styles.scheduler}><span><Activity size={16} aria-hidden /> Penjadwal</span>
    <Badge tone={status.schedulerReady ? 'good' : 'warn'}>{status.schedulerReady ? 'Siap' : 'Perlu diperiksa'}</Badge>
    <small>{status.lastTickAt ? 'Pemeriksaan terakhir: ' + stamp(status.lastTickAt) : 'Belum ada pemeriksaan tercatat'}</small>
  </div>;
}

function Overview({ data, open, operations, pause }: { data: AdminOverview; open: (id: string) => void; operations: (filter: Filter) => void; pause: (rule: AdminRule) => void }) {
  const stats = [
    { label: 'Workspace aktif', value: data.activeWorkspaces, caption: 'Onboarding selesai', icon: Building2 },
    { label: 'Publikasi dikonfirmasi hari ini', value: data.publishedToday, caption: 'Satu hitungan per draf · WIB', icon: Send, minimum: data.publishedLowerBound },
    { label: 'Dalam pemulihan', value: data.recovering, caption: 'Antrean dan percobaan ulang', icon: RefreshCw, minimum: data.activityPartial, action: () => operations('recovery') },
    { label: 'Slot perlu diperiksa', value: data.attention, caption: 'Gagal, terlewat, atau belum pasti · 7 hari', icon: CircleAlert, minimum: data.activityPartial, action: () => operations('attention') },
  ];
  return <>
    <div className={styles.stats}>{stats.map(({label,value,caption,icon: Icon,minimum,action}) => {
      const body = <><span className={styles.statLabel}><Icon size={18} aria-hidden />{label}</span><strong>{minimum ? '≥ ' : ''}{number.format(value)}</strong><span className={styles.meta}>{caption}</span></>;
      return action ? <button key={label} type="button" className={styles.stat} onClick={action}>{body}</button>
        : <article key={label} className={styles.stat}>{body}</article>;
    })}</div>
    <div className={styles.split}>
      <Panel title="Antrean perhatian" hint="Hasil yang belum pasti ditampilkan paling atas.">
        <JobList jobs={data.actions} pause={pause} empty="Tidak ada aktivitas yang perlu ditinjau saat ini." />
        <button className={styles.link} type="button" onClick={() => operations('all')}>Buka Operasi Otonom <ArrowRight size={16} /></button>
      </Panel>
      <Panel title="Slot berikutnya" hint="Jadwal aktif terdekat, dalam WIB.">
        <RuleList rules={data.upcoming} open={open} empty="Belum ada slot aktif yang akan datang." />
      </Panel>
    </div>
    {data.blocked.length > 0 && <Panel title="Aturan perlu diperiksa" hint="Aturan dengan masalah yang masih tercatat, termasuk yang berhenti sebelum membuat slot.">
      <RuleList rules={data.blocked} open={open} pause={pause} empty="" />
    </Panel>}
  </>;
}

function WorkspaceDetail({ data, pause, openSettings }: { data: AdminWorkspaceDetail; pause: (rule: AdminRule) => void; openSettings: () => void }) {
  const { workspace, publication, generation } = data;
  const renderAccounts = (accounts: AdminWorkspaceDetail['unassigned']) => accounts.length ? <ul className={styles.receipts}>{accounts.map(account => <li key={account.id}>
    <span>{channelName(account.channel)} · {account.label}</span><Badge tone={account.ready ? 'good' : 'warn'}>{account.ready ? 'Terhubung' : 'Izin berakhir'}</Badge>
  </li>)}</ul> : <p className={styles.meta}>Belum ada akun sosial tertaut.</p>;
  return <>
    <Panel title={workspace.name}>
      <p className={styles.description}><bdi>{workspace.id}</bdi> · {workspace.plan} · {workspace.onboarded ? 'Onboarding selesai' : 'Onboarding belum selesai'}</p>
      <dl className={styles.quota}>
        <div><dt>Kuota publikasi bulanan</dt><dd>{number.format(Math.max(0, publication.limit - publication.used))} tersisa</dd><small>{publication.used} dari {publication.limit} terpakai atau dicadangkan · {publication.month} WIB</small></div>
        {publication.dailyUsed !== undefined && publication.dailyLimit !== undefined && <div>
          <dt>Kuota publikasi harian</dt><dd>{publication.dailyLimit === null ? 'Tanpa batas harian' : number.format(Math.max(0, publication.dailyLimit - publication.dailyUsed)) + ' tersisa'}</dd>
          <small>{publication.dailyUsed}{publication.dailyLimit === null ? '' : ' dari ' + publication.dailyLimit} terpakai atau dicadangkan · {publication.day} WIB</small>
        </div>}
        <div><dt>Kuota pembuatan draf harian</dt><dd>{generation.dailyLimit === null ? 'Tanpa batas harian' : number.format(Math.max(0, generation.dailyLimit - generation.used)) + ' tersisa'}</dd><small>{generation.used}{generation.dailyLimit === null ? ' percobaan · Mode pengembangan' : ' dari ' + generation.dailyLimit + ' percobaan'} · {generation.day} WIB</small></div>
      </dl>
      <button type="button" className={styles.link} onClick={openSettings}>Pengaturan AI &amp; kuota workspace <ArrowRight size={16} aria-hidden /></button>
    </Panel>
    <Panel title="Bisnis dan akun sosial" hint="Setiap bisnis punya akun tujuan dan aturan Otonom sendiri.">
      {data.profileStatus !== 'ready' && <p className={styles.empty}>{data.profileStatus === 'missing' ? 'Profil bisnis belum tersedia.' : 'Profil bisnis belum dapat dibaca. Muat ulang atau periksa data workspace.'}</p>}
      <ul className={styles.businesses}>{data.businesses.map(business => <li key={business.id}>
        <div className={styles.businessHeader}><h3>{business.name}</h3>{business.rule ? <RuleBadge rule={business.rule} /> : <Badge tone="muted">Belum ada aturan</Badge>}</div>
        {business.rule?.issue && <p className={styles.meta}>{business.rule.issue}</p>}
        {renderAccounts(business.accounts)}
        {business.rule?.enabled && <div className={styles.rowActions}>
          {business.rule.nextSlot && <span className={styles.meta}>Slot berikutnya: {stamp(business.rule.nextSlot)}</span>}
          <button type="button" className={styles.button} onClick={() => pause(business.rule!)}><Pause size={16} /> Jeda aturan<span className="sr-only"> {business.name}</span></button>
        </div>}
      </li>)}</ul>
      {data.unassigned.length > 0 && <div className={styles.unassigned}><h3>Akun belum ditautkan ke bisnis</h3>{renderAccounts(data.unassigned)}</div>}
    </Panel>
    <Panel title="Riwayat Otonom" hint="Hingga 24 aktivitas terakhir dalam workspace ini."><JobList jobs={data.jobs} pause={pause} /></Panel>
    {!!data.pauseAudit?.length && <Panel title="Riwayat jeda oleh admin">
      <ol className={styles.pauseAudit}>{data.pauseAudit.map(entry => <li key={entry.id}>
        <div><strong>{entry.businessName}</strong> {entry.processing && <Badge tone="info">Proses masih berjalan saat dijeda</Badge>}</div>
        <span className={styles.meta}>{entry.actor} · {stamp(entry.at)}</span>
        <p>{entry.reason}</p>
      </li>)}</ol>
    </Panel>}
  </>;
}

function PauseDialog({ rule, close, save, request }: { rule: AdminRule; close: () => void; save: (processing: boolean) => void; request: AdminRequest }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 5 || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const result = await request<{ processing: boolean }>(endpoint, { method: 'PATCH', body: JSON.stringify({ workspaceId: rule.workspaceId, businessId: rule.businessId, expectedRevision: rule.revision, reason }) });
      save(result.processing);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Aturan belum dapat dijeda. Muat ulang untuk memeriksa statusnya.');
      setPending(false);
    } finally { submitting.current = false; }
  }
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="admin-pause-title" onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
    <form onSubmit={submit}>
      <div className={styles.dialogHead}><h2 id="admin-pause-title">Jeda aturan Otonom?</h2><button type="button" className={styles.iconButton} disabled={pending} onClick={close} aria-label="Tutup dialog"><X size={20} /></button></div>
      <p><strong>{rule.businessName}</strong>{rule.workspaceName !== rule.businessName && ' · ' + rule.workspaceName}</p>
      <p className={styles.description}>Slot dan pengiriman ulang untuk bisnis ini akan dijeda. Kiriman yang sudah dikirim ke Meta masih bisa selesai.</p>
      <label htmlFor="admin-pause-reason">Alasan jeda</label>
      <textarea id="admin-pause-reason" rows={3} maxLength={240} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} required placeholder="Contoh: Periksa hasil kirim yang belum pasti." />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.dialogActions}>
        <button className={styles.button} type="button" disabled={pending} onClick={close}>Batal</button>
        <button className={styles.primary} type="submit" disabled={pending || reason.trim().length < 5}>{pending ? 'Menjeda…' : 'Jeda aturan'}</button>
      </div>
    </form>
  </dialog>;
}

function DiscardSettingsDialog({ close, discard }: { close: () => void; discard: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, []);
  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="admin-discard-settings-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { event.preventDefault(); discard(); }}>
      <h2 id="admin-discard-settings-title">Buang perubahan yang belum disimpan?</h2>
      <p className={styles.description}>Nilai yang sudah tersimpan tetap berlaku.</p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} onClick={close}>Lanjut mengedit</button>
        <button type="submit" className={styles.primary}>Buang perubahan</button>
      </div>
    </form>
  </dialog>;
}

export function VeloxaSuperAdmin({ request = veloxaApi }: { request?: AdminRequest }) {
  const [view, setView] = useState<View>('overview');
  const [filter, setFilter] = useState<Filter>('all');
  const [workspace, setWorkspace] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [cursor, setCursor] = useState('');
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; data?: AdminData; error?: string }>();
  const [notice, setNotice] = useState('');
  const [pause, setPause] = useState<AdminRule | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [discardTo, setDiscardTo] = useState<View | 'reload' | null>(null);
  const editingSettings = view === 'settings' || view === 'workspaceSettings';
  const params = new URLSearchParams(editingSettings ? undefined : { view });
  if (view === 'workspaceSettings') params.set('workspaceId', workspace);
  if (view === 'workspaces') { if (term) params.set('q',term); if (cursor) params.set('cursor',cursor); }
  if (view === 'workspace') params.set('workspaceId',workspace);
  if (view === 'operations') params.set('state',filter);
  const path = (editingSettings ? settingsEndpoint : endpoint) + (params.size ? '?' + params : '');
  const key = path + '#' + refresh;
  const result = response?.key === key ? response : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void request<AdminData>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setResponse({ key, data }); },
      error => { if (!controller.signal.aborted) setResponse({ key, error: error instanceof Error ? error.message : 'Coba muat ulang panel.' }); },
    );
    return () => controller.abort();
  }, [key, path, request]);
  const load = () => setRefresh(current => current + 1);
  const navigate = (next: View | 'reload') => {
    if (next === view) return;
    if (editingSettings && settingsDirty) { setDiscardTo(next); return; }
    setNotice('');
    if (next === 'reload') load();
    else setView(next);
  };
  const open = (id: string) => { setWorkspace(id); navigate('workspace'); };
  const operations = (state: Filter) => { setFilter(state); navigate('operations'); };
  const titles = { overview: 'Beranda', workspace: 'Detail Workspace', workspaces: 'Workspace', operations: 'Operasi Otonom',
    settings: 'Pengaturan AI & kuota', workspaceSettings: 'Pengaturan workspace' };
  const sub = { overview: 'Lihat kesehatan platform dan pekerjaan yang perlu ditangani.', workspaces: 'Temukan workspace, paket, dan bisnis yang dikelola.',
    workspace: 'Periksa kuota, koneksi bisnis, dan hasil Otonom.', operations: 'Periksa status slot, hasil per akun, dan jadwal percobaan ulang.',
    settings: 'Atur model bawaan, batas paket, dan riwayat perubahan platform.',
    workspaceSettings: 'Atur model dan kuota khusus untuk workspace ini.' };
  const data = result?.data;
  const page = view === 'workspaces' ? data as AdminWorkspacePage | undefined : undefined;
  const ops = view === 'operations' ? data as AdminOperations | undefined : undefined;
  const overview = view === 'overview' ? data as AdminOverview | undefined : undefined;
  return <div className={styles.admin} lang="id" dir="ltr" data-testid="super-admin-dashboard">
    <nav className={styles.nav} aria-label="Navigasi Super Admin">
      {([['overview','Beranda'],['workspaces','Workspace'],['operations','Operasi Otonom'],['settings','Pengaturan AI & kuota']] as const).map(([id,label]) =>
        <button key={id} type="button" aria-current={view === id || (view === 'workspace' || view === 'workspaceSettings') && id === 'workspaces' ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}
    </nav>
    <div className={styles.heading}>
      <div>
        {view === 'workspace' && <button type="button" className={styles.link} onClick={() => navigate('workspaces')}><ArrowLeft size={16} /> Kembali ke Workspace</button>}
        {view === 'workspaceSettings' && <button type="button" className={styles.link} onClick={() => navigate('workspace')}><ArrowLeft size={16} /> Kembali ke Detail Workspace</button>}
        <h1>{titles[view]}</h1><p>{sub[view]}</p>
      </div>
      <button type="button" className={styles.button} disabled={!result} onClick={() => navigate('reload')}><RefreshCw size={16} /> Muat ulang</button>
    </div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {(overview || ops) && <Scheduler status={(overview || ops)!.scheduler} />}
    {(overview?.activityPartial || ops?.activityPartial) && <p className={styles.note} role="status">Sebagian aktivitas dan jadwal tersedia. Buka Detail Workspace untuk melihat riwayat bisnis tertentu.</p>}
    {view === 'workspaces' && <form className={styles.search} onSubmit={event => { event.preventDefault(); setTerm(search.trim()); setCursor(''); setPreviousCursors([]); }}>
      <div><label htmlFor="admin-workspace-search">Cari workspace</label><input type="search" id="admin-workspace-search" placeholder="Awal nama atau ID workspace" maxLength={110} value={search} onChange={event => setSearch(event.target.value)} /></div>
      <button className={styles.primary} type="submit">Cari</button>
      {term && <button className={styles.button} type="button" onClick={() => { setSearch(''); setTerm(''); setCursor(''); setPreviousCursors([]); }}>Hapus filter</button>}
    </form>}
    {view === 'operations' && <div className={styles.filters} aria-label="Filter aktivitas">
      {([['all','Terbaru'],['attention','Perlu diperiksa'],['recovery','Dalam pemulihan']] as const).map(([id,label]) => <button key={id} type="button" className={styles.button} aria-pressed={id === filter} onClick={() => setFilter(id)}>{label}</button>)}
    </div>}
    {!result && <p className={styles.empty} role="status">Memuat data Super Admin…</p>}
    {result?.error && <p className={styles.error} role="alert">Data belum dapat dimuat. {result.error}</p>}
    {overview && <Overview data={overview} open={open} operations={operations} pause={setPause} />}
    {page && <Panel title="Daftar workspace" hint={term ? 'Nama dicocokkan dari awal, dengan huruf besar dan kecil sesuai data.' : undefined}>
      {page.items.length ? <ul className={styles.list}>{page.items.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><span className={styles.meta}>{item.plan} · {item.onboarded ? 'Onboarding selesai' : 'Onboarding belum selesai'}</span><span className={styles.meta}><bdi>{item.id}</bdi></span></div>
        <button type="button" className={styles.button} onClick={() => open(item.id)}>Detail<span className="sr-only"> {item.name}</span><ArrowRight size={16} /></button>
      </li>)}</ul> : <p className={styles.empty}>Tidak ada workspace yang cocok.</p>}
      {(previousCursors.length > 0 || page.cursor) && <div className={styles.rowActions}>
        <button type="button" className={styles.button} disabled={!previousCursors.length} onClick={() => { setCursor(previousCursors.at(-1) || ''); setPreviousCursors(list => list.slice(0,-1)); }}>Sebelumnya</button>
        <button type="button" className={styles.button} disabled={!page.cursor} onClick={() => { setPreviousCursors(list => [...list,cursor]); setCursor(page.cursor!); }}>Berikutnya</button>
      </div>}
    </Panel>}
    {view === 'workspace' && data && <WorkspaceDetail data={data as AdminWorkspaceDetail} pause={setPause} openSettings={() => navigate('workspaceSettings')} />}
    {editingSettings && data && <VeloxaAdminSettings key={key} data={data as AdminSettingsView} request={request}
      endpoint={settingsEndpoint} onDirty={setSettingsDirty} onReset={() => navigate('reload')} onSaved={restored => {
        setNotice(restored ? 'Pengaturan dipulihkan sebagai revisi baru.' : 'Pengaturan tersimpan.');
        load();
      }} />}
    {ops && <div className={styles.split}>
      <Panel title="Aktivitas slot" hint="Hingga 40 aktivitas terbaru untuk filter ini. Buka slot untuk melihat hasil per akun."><JobList jobs={ops.jobs} pause={setPause} /></Panel>
      <div className={styles.stack}>
        <Panel title="Aturan aktif" hint={ops.ruleLimitReached ? 'Menampilkan 25 aturan aktif terdekat. Buka Detail Workspace untuk aturan lainnya.' : undefined}><RuleList rules={ops.rules} open={open} pause={setPause} empty="Tidak ada aturan aktif." /></Panel>
        {ops.blocked.length > 0 && <Panel title="Aturan perlu diperiksa"><RuleList rules={ops.blocked} open={open} empty="" /></Panel>}
      </div>
    </div>}
    {discardTo && <DiscardSettingsDialog close={() => setDiscardTo(null)} discard={() => {
      setDiscardTo(null);
      setSettingsDirty(false);
      setNotice('');
      if (discardTo === 'reload') load();
      else setView(discardTo);
    }} />}
    {pause && <PauseDialog rule={pause} close={() => setPause(null)} request={request} save={processing => {
      setPause(null);
      setNotice(processing ? 'Jeda disimpan. Proses yang sedang berjalan masih diperiksa.' : 'Aturan Otonom sudah dijeda.');
      load();
    }} />}
  </div>;
}
