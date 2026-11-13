'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CircleAlert } from 'lucide-react';
import type { AdminIncident, AdminIncidents, AdminIncidentStatus } from '@/lib/admin-incidents';
import styles from './VeloxaSuperAdmin.module.css';

type AdminRequest = <T>(url: string, init?: RequestInit) => Promise<T>;
type SavedIncident = Pick<AdminIncident, 'status' | 'revision' | 'history'>;
const endpoint = '/api/veloxa/admin/incidents/';
const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const stamp = (value: number) => dateTime.format(value) + ' WIB';
const stateLabel: Record<AdminIncidentStatus, string> = { open: 'Perlu ditangani', investigating: 'Sedang ditangani', resolved: 'Penanganan selesai' };
const stateTone: Record<AdminIncidentStatus, string> = { open: 'warn', investigating: 'info', resolved: 'good' };
const actionLabel: Record<AdminIncidentStatus, string> = { open: 'Buka kembali', investigating: 'Mulai tangani', resolved: 'Tandai selesai' };
const availableActions: Record<AdminIncidentStatus, AdminIncidentStatus[]> = {
  open: ['investigating', 'resolved'], investigating: ['resolved', 'open'], resolved: ['open'],
};

function IncidentCard({ incident, request, open, onSaved }: {
  incident: AdminIncident; request: AdminRequest; open: (workspaceId: string) => void; onSaved: (result: SavedIncident) => void;
}) {
  const noteId = useId();
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const summary = useRef<HTMLElement>(null);
  const submitPending = useRef(false);
  const [nextStatus, setNextStatus] = useState<AdminIncidentStatus | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (nextStatus) noteInput.current?.focus(); }, [nextStatus]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!nextStatus || note.trim().length < 5 || submitPending.current) return;
    submitPending.current = true;
    setPending(true);
    setError('');
    try {
      const result = await request<SavedIncident>(endpoint, { method: 'PATCH', body: JSON.stringify({
        source: incident.source, expectedRevision: incident.revision, status: nextStatus, note,
      }) });
      setNextStatus(null);
      setNote('');
      summary.current?.focus();
      onSaved(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Catatan belum dapat disimpan.');
    } finally {
      submitPending.current = false;
      setPending(false);
    }
  }

  const workspaceId = incident.source.kind === 'scheduler' ? null : incident.source.workspaceId;
  const scope = workspaceId === null ? 'Seluruh platform'
    : [incident.businessName, incident.workspaceName !== incident.businessName ? incident.workspaceName : null].filter(Boolean).join(' · ');
  const metadata = [scope, incident.at ? stamp(incident.at) : null].filter(Boolean).join(' · ');
  return <details className={styles.job}>
    <summary ref={summary}>
      <span className={styles.jobName}><strong>{incident.title}</strong><span className={styles.meta}>{metadata}</span></span>
      <span className={styles.badge} data-tone={stateTone[incident.status]}>{stateLabel[incident.status]}</span>
    </summary>
    <div className={styles.jobDetail}>
      {incident.detected && <span className={styles.badge} data-tone={incident.priority === 'urgent' ? 'bad' : 'warn'}>
        {incident.priority === 'urgent' ? 'Mendesak' : 'Perlu diperiksa'}
      </span>}
      <p>{incident.guidance}</p>
      {incident.failedSlots && <p className={styles.note}>Kegagalan berulang · {incident.failedSlots} slot gagal pada bisnis ini dalam pemeriksaan tujuh hari terakhir.</p>}
      {incident.status === 'resolved' && incident.detected && <p className={styles.note}>Kondisi ini masih terdeteksi saat daftar diperiksa.</p>}
      {!!incident.receipts?.length && <ul className={styles.receipts} aria-label="Hasil per akun">
        {incident.receipts.map((receipt, index) => <li key={`${receipt.channel}-${receipt.account}-${index}`}>
          <span>{receipt.channel === 'instagram' ? 'Instagram' : 'Facebook'} · {receipt.account}</span>
          <span className={styles.badge} data-tone={receipt.status === 'published' ? 'good' : 'bad'}>
            {receipt.status === 'published' ? 'Terbit' : receipt.status === 'failed' ? 'Gagal' : 'Belum pasti'}
          </span>
          {receipt.permalink && <a href={receipt.permalink} target="_blank" rel="noreferrer">Lihat kiriman</a>}
        </li>)}
      </ul>}
      {workspaceId && <button type="button" className={styles.link} onClick={() => open(workspaceId)}>Detail Workspace <ArrowRight size={16} aria-hidden /></button>}
      {incident.history.length > 0 && <div className={styles.incidentHistory}>
        <h3>Riwayat penanganan</h3>
        <ol className={styles.pauseAudit}>{incident.history.map((entry, index) => <li key={`${entry.at}-${index}`}>
          <strong>{stateLabel[entry.status]}</strong><span className={styles.meta}>{entry.actor} · {stamp(entry.at)}</span><p>{entry.note}</p>
        </li>)}</ol>
      </div>}
      {!nextStatus && <div className={styles.rowActions}>
        {availableActions[incident.status].map(action => <button type="button" key={action} className={styles.button} onClick={() => {
          setError(''); setNextStatus(action);
        }}>{actionLabel[action]}</button>)}
      </div>}
      {nextStatus && <form className={styles.incidentForm} onSubmit={save}>
        <label htmlFor={noteId}>{actionLabel[nextStatus]} dengan catatan</label>
        <textarea id={noteId} ref={noteInput} value={note} onChange={event => setNote(event.target.value)} rows={3} minLength={5} maxLength={240} required disabled={pending} />
        <p className={styles.meta}>Perubahan ini mencatat penanganan tim. Pengiriman dikelola melalui aturan Otonom dan akun tujuan.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.rowActions}>
          <button type="button" className={styles.button} disabled={pending} onClick={() => { setNextStatus(null); setError(''); summary.current?.focus(); }}>Batal</button>
          <button type="submit" className={styles.primary} disabled={pending || note.trim().length < 5}>{pending ? 'Menyimpan…' : 'Simpan penanganan'}</button>
        </div>
      </form>}
    </div>
  </details>;
}

export function VeloxaAdminIncidents({ request, open, refresh }: { request: AdminRequest; open: (workspaceId: string) => void; refresh: number }) {
  const activeFilter = useRef<HTMLButtonElement>(null);
  const resolvedFilter = useRef<HTMLButtonElement>(null);
  const [response, setResponse] = useState<AdminIncidents>();
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<AdminIncidents>(endpoint, { signal: controller.signal }).then(
      result => { if (!controller.signal.aborted) { setResponse(result); setLoading(false); } },
      reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Daftar insiden belum dapat dimuat.'); setLoading(false); } },
    );
    return () => controller.abort();
  }, [refresh, request, retry]);

  const visible = response?.incidents.filter(item => filter === 'resolved' ? item.status === 'resolved' : item.status !== 'resolved') ?? [];
  return <section className={styles.panel} aria-labelledby="admin-incidents-title">
    <div className={styles.businessHeader}>
      <h2 id="admin-incidents-title" className={styles.incidentTitle}><CircleAlert size={18} aria-hidden /> Insiden Otonom</h2>
      <div className={styles.rowActions} aria-label="Filter insiden">
        <button ref={activeFilter} type="button" className={styles.button} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Aktif</button>
        <button ref={resolvedFilter} type="button" className={styles.button} aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>Selesai</button>
      </div>
    </div>
    <p className={styles.description}>Pemeriksaan penjadwal, aturan, dan hasil slot tujuh hari terakhir.</p>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p className={styles.empty} role="status">Memeriksa insiden…</p> : error ? <div className={styles.jobDetail}>
      <p className={styles.error} role="alert">{error}</p>
      <button type="button" className={styles.button} onClick={() => setRetry(current => current + 1)}>Coba lagi</button>
    </div> : <>
      {response?.partial && <p className={styles.note}>Sebagian insiden terbaru ditampilkan. Riwayat slot per bisnis tersedia di Detail Workspace.</p>}
      {visible.length > 0 ? <div className={styles.jobs}>{visible.map(incident => <IncidentCard key={incident.id} incident={incident} request={request} open={open} onSaved={result => {
        setNotice(result.status === 'resolved' ? 'Penanganan insiden ditandai selesai.' : result.status === 'open' ? 'Insiden dibuka kembali.' : 'Penanganan insiden dicatat.');
        if ((incident.status === 'resolved') !== (result.status === 'resolved')) (filter === 'active' ? activeFilter : resolvedFilter).current?.focus();
        setResponse(current => current && { ...current, incidents: current.incidents.map(row => row.id === incident.id ? { ...row, ...result } : row) });
      }} />)}</div> : <p className={styles.empty}>{filter === 'active' ? 'Tidak ada insiden aktif pada pemeriksaan ini.' : 'Belum ada insiden yang selesai ditangani.'}</p>}
    </>}
  </section>;
}
