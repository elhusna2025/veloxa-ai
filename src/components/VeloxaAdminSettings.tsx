'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { History, Save, X } from 'lucide-react';
import type {
  AdminModelOverrides, AdminPlanSettings, AdminQuotaOverrides, AdminSettingsUpdate, AdminSettingsView,
} from '@/lib/admin-settings';
import { VeloxaSelect } from './VeloxaSelect';
import styles from './VeloxaSuperAdmin.module.css';
import settings from './VeloxaAdminSettings.module.css';

type RequestSettings = <T>(url: string, init?: RequestInit) => Promise<T>;
type Change = Omit<AdminSettingsUpdate, 'workspaceId' | 'expectedRevision' | 'reason'>;
type LimitKey = 'dailyDraftLimit' | 'dailyPublicationLimit' | 'monthlyPublicationLimit';
type LimitFields = Record<LimitKey, string>;
const modelFields = [
  { key: 'scriptModel', label: 'Model naskah & caption' },
  { key: 'imageModel', label: 'Model gambar' },
  { key: 'voiceModel', label: 'Model narasi suara' },
] as const;
const limitFields = [
  { key: 'dailyDraftLimit', label: 'Pembuatan draf per hari' },
  { key: 'dailyPublicationLimit', label: 'Publikasi per hari' },
  { key: 'monthlyPublicationLimit', label: 'Publikasi per bulan' },
] as const;
const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const number = new Intl.NumberFormat('id-ID');
const savedLimits = (limits: Partial<Record<LimitKey, number | null>>): LimitFields => ({
  dailyDraftLimit: String(limits.dailyDraftLimit ?? ''),
  dailyPublicationLimit: String(limits.dailyPublicationLimit ?? ''),
  monthlyPublicationLimit: String(limits.monthlyPublicationLimit ?? ''),
});
const sameLimits = (a: LimitFields, b: LimitFields) => limitFields.every(({ key }) => a[key] === b[key]);
const validLimit = (key: LimitKey, value: string) => /^\d+$/.test(value) && Number(value) <= (key === 'monthlyPublicationLimit' ? 1_000_000 : 10_000);
const displayLimit = (value: number | null) => value === null ? 'Tanpa batas' : number.format(value);

function LimitInputs({ values, workspace, noDraftLimit, setNoDraftLimit, onChange }: {
  values: LimitFields;
  workspace?: boolean;
  noDraftLimit?: boolean;
  setNoDraftLimit?: (value: boolean) => void;
  onChange: (key: LimitKey, value: string) => void;
}) {
  const id = useId();
  return <div className={settings.limitFields}>
    {limitFields.map(({ key, label }) => {
      const unlimited = workspace && key === 'dailyDraftLimit' && noDraftLimit;
      const placeholder = workspace ? 'Ikuti paket' : key === 'dailyPublicationLimit' ? 'Tanpa batas' : 'Isi batas paket';
      return <div key={key} className={settings.field}>
        <label htmlFor={id + key}>{label}</label>
        <input id={id + key} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={12}
          value={unlimited ? '' : values[key]} disabled={unlimited} placeholder={unlimited ? 'Tanpa batas' : placeholder}
          required={!workspace && key !== 'dailyPublicationLimit'} onChange={event => onChange(key, event.target.value)} />
        {workspace && key === 'dailyDraftLimit' && <label className={settings.checkbox}>
          <input type="checkbox" checked={!!noDraftLimit} onChange={event => setNoDraftLimit?.(event.target.checked)} /> Tanpa batas pembuatan draf
        </label>}
      </div>;
    })}
  </div>;
}

function SettingsConfirmation({ scope, revision, change, summary, close, save }: {
  scope: string;
  revision: number;
  change: Change;
  summary: string[];
  close: () => void;
  save: (reason: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const restoring = change.restoreRevision !== undefined;
  useEffect(() => {
    const element = dialog.current!;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 5 || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await save(reason.trim());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Pengaturan belum disimpan. Coba lagi.');
      setPending(false);
    } finally {
      submitting.current = false;
    }
  }

  return <dialog className={styles.dialog} ref={dialog} aria-labelledby="admin-settings-confirm-title"
    onCancel={event => { event.preventDefault(); if (!pending) close(); }}>
    <form onSubmit={submit}>
      <div className={styles.dialogHead}>
        <h2 id="admin-settings-confirm-title">{restoring ? 'Pulihkan pengaturan?' : 'Simpan pengaturan?'}</h2>
        <button type="button" className={styles.iconButton} disabled={pending} onClick={close} aria-label="Tutup dialog"><X size={20} /></button>
      </div>
      <p><strong>{scope}</strong> <span className={styles.meta}>Revisi saat ini {revision}</span></p>
      {restoring ? <p className={styles.description}>Pengaturan pada revisi {change.restoreRevision} akan dipakai sebagai revisi baru.</p>
        : <ul className={settings.summary}>{summary.map(item => <li key={item}>{item}</li>)}</ul>}
      <label htmlFor="admin-settings-reason">Alasan perubahan</label>
      <textarea id="admin-settings-reason" rows={3} maxLength={240} value={reason} disabled={pending}
        onChange={event => setReason(event.target.value)} required minLength={5} placeholder="Contoh: Uji model gambar untuk workspace ini." />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} disabled={pending} onClick={close}>Batal</button>
        <button type="submit" className={styles.primary} disabled={pending || reason.trim().length < 5}>
          {pending ? (restoring ? 'Memulihkan…' : 'Menyimpan…') : (restoring ? 'Pulihkan pengaturan' : 'Simpan pengaturan')}
        </button>
      </div>
    </form>
  </dialog>;
}

export function VeloxaAdminSettings({ data, request, endpoint, onDirty, onSaved, onReset }: {
  data: AdminSettingsView;
  request: RequestSettings;
  endpoint: string;
  onDirty: (dirty: boolean) => void;
  onSaved: (restored: boolean) => void;
  onReset: () => void;
}) {
  const [models, setModels] = useState<AdminModelOverrides>(data.models);
  const [workspaceLimits, setWorkspaceLimits] = useState<LimitFields>(() => savedLimits(data.scope === 'workspace' ? data.quota : {}));
  const [noDraftLimit, setNoDraftLimit] = useState(data.scope === 'workspace' && data.quota.dailyDraftLimit === null);
  const [editedPlans, setEditedPlans] = useState<Record<string, LimitFields>>({});
  const [selectedPlanId, setSelectedPlanId] = useState(data.scope === 'global' ? data.plans[0]?.id ?? '' : '');
  const [confirmation, setConfirmation] = useState<Change | null>(null);
  const global = data.scope === 'global';
  const plans = global ? data.plans : [];
  const selectedPlan = plans.find(plan => plan.id === selectedPlanId);
  const scope = global ? 'Seluruh platform' : data.workspaceName;
  const workspace = global ? undefined : data.workspaceId;
  const changedModelFields = modelFields.filter(({ key }) => models[key] !== data.models[key]);
  const modelChanged = changedModelFields.length > 0;
  const unavailableSelection = modelChanged && modelFields.some(({ key }) => models[key] && !data.availableModels[key].includes(models[key]!));
  const originalWorkspaceLimits = savedLimits(global ? {} : data.quota);
  const workspaceChanged = !global && (!sameLimits(originalWorkspaceLimits, workspaceLimits) || noDraftLimit !== (data.quota.dailyDraftLimit === null));
  const changedPlans = plans.filter(plan => editedPlans[plan.id] && !sameLimits(savedLimits(plan), editedPlans[plan.id]));
  const dirty = modelChanged || workspaceChanged || changedPlans.length > 0;
  const invalidWorkspace = !global && limitFields.some(({ key }) => !(key === 'dailyDraftLimit' && noDraftLimit) && !!workspaceLimits[key] && !validLimit(key, workspaceLimits[key]));
  const invalidPlan = changedPlans.find(plan => limitFields.some(({ key }) => {
    const value = editedPlans[plan.id][key];
    return key === 'dailyPublicationLimit' ? !!value && !validLimit(key, value) : !validLimit(key, value);
  }));
  const invalid = unavailableSelection || invalidWorkspace || !!invalidPlan;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const selectModel = (key: keyof AdminModelOverrides, value: string) => {
    setModels(current => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };
  const quotaUpdate = () => {
    const quota: AdminQuotaOverrides = {};
    for (const { key } of limitFields) {
      if (key === 'dailyDraftLimit' && noDraftLimit) quota.dailyDraftLimit = null;
      else if (workspaceLimits[key]) quota[key] = Number(workspaceLimits[key]);
    }
    return quota;
  };
  const planUpdate = (plan: AdminPlanSettings) => {
    const values = editedPlans[plan.id];
    return {
      id: plan.id,
      dailyDraftLimit: Number(values.dailyDraftLimit),
      dailyPublicationLimit: values.dailyPublicationLimit ? Number(values.dailyPublicationLimit) : null,
      monthlyPublicationLimit: Number(values.monthlyPublicationLimit),
    };
  };
  const summary = [
    ...changedModelFields.map(({ key, label }) => `${label} · ${models[key] ?? data.defaultModels[key]}`),
    ...(workspaceChanged ? limitFields.filter(({ key }) => workspaceLimits[key] !== originalWorkspaceLimits[key] || key === 'dailyDraftLimit' && !global && noDraftLimit !== (data.quota.dailyDraftLimit === null)).map(({ key, label }) =>
      `${label} · ${key === 'dailyDraftLimit' && noDraftLimit ? 'Tanpa batas' : workspaceLimits[key] || 'Ikuti paket'}`) : []),
    ...changedPlans.flatMap(plan => limitFields.filter(({ key }) => editedPlans[plan.id][key] !== savedLimits(plan)[key]).map(({ key, label }) =>
      `${plan.label} · ${label} · ${editedPlans[plan.id][key] || 'Tanpa batas'}`)),
  ];

  return <>
    <div className={settings.context}>
      <strong>{scope}</strong>
      <span className={styles.badge} data-tone={dirty ? 'warn' : 'muted'} role="status">{dirty ? 'Perubahan belum disimpan' : `Revisi ${data.revision} tersimpan`}</span>
    </div>
    <form className={settings.form} onSubmit={event => {
      event.preventDefault();
      if (!dirty || invalid) return;
      setConfirmation({
        ...(modelChanged ? { models } : {}),
        ...(workspaceChanged ? { quota: quotaUpdate() } : {}),
        ...(changedPlans.length ? { plans: changedPlans.map(planUpdate) } : {}),
      });
    }}>
      <section className={styles.panel} aria-labelledby="admin-model-settings-title">
        <h2 id="admin-model-settings-title">Model AI</h2>
        <p className={styles.description}>{global ? 'Model ini berlaku untuk workspace tanpa pilihan khusus.' : 'Pilih model khusus atau ikuti pengaturan platform.'}</p>
        <div className={settings.modelFields}>
          {modelFields.map(({ key, label }) => {
            const choices = data.availableModels[key];
            const chosen = models[key];
            const unavailable = !!chosen && !choices.includes(chosen);
            const stored = data.models[key];
            const storedUnavailable = !!stored && !choices.includes(stored);
            const id = 'admin-model-' + key;
            return <div key={key} className={settings.field}>
              <label htmlFor={id}>{label}</label>
              <VeloxaSelect id={id} value={chosen ?? ''} onValueChange={value => selectModel(key, value)}>
                <option value="">{global ? 'Bawaan' : 'Ikuti platform'} · {data.defaultModels[key]}</option>
                {unavailable && <option value={chosen} disabled>{chosen} (tidak tersedia)</option>}
                {choices.map(model => <option key={model} value={model}>{model}</option>)}
              </VeloxaSelect>
              {storedUnavailable && <p className={styles.meta}>Model tersimpan sudah tidak tersedia. Model yang sedang digunakan: {data.effectiveModels[key]}.</p>}
            </div>;
          })}
        </div>
        {unavailableSelection && <p role="status" className={styles.note}>Ganti model yang sudah tidak tersedia atau pilih model bawaan sebelum menyimpan pengaturan model.</p>}
      </section>
      <section className={styles.panel} aria-labelledby="admin-limit-settings-title">
        <h2 id="admin-limit-settings-title">{global ? 'Kuota per paket' : 'Kuota khusus workspace'}</h2>
        <p className={styles.meta}>Batas 0 menahan pembuatan draf atau publikasi baru sesuai jenis kuota.</p>
        {global ? <>
          <p className={styles.description}>Isi batas draf harian dan publikasi bulanan. Batas publikasi harian boleh dikosongkan.</p>
          <div className={settings.planPicker}>
            <label htmlFor="admin-settings-plan">Pilih paket</label>
            <VeloxaSelect id="admin-settings-plan" value={selectedPlanId} onValueChange={id => {
              const plan = plans.find(item => item.id === id);
              if (plan) setSelectedPlanId(plan.id);
            }}>
              {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
            </VeloxaSelect>
          </div>
          {selectedPlan && <LimitInputs values={editedPlans[selectedPlan.id] ?? savedLimits(selectedPlan)}
            onChange={(key, value) => setEditedPlans(current => ({ ...current, [selectedPlan.id]: { ...(current[selectedPlan.id] ?? savedLimits(selectedPlan)), [key]: value } }))} />}
          {invalidPlan && <p role="status" className={styles.error}>Periksa angka kuota untuk {invalidPlan.label}. Maksimal 10.000 per hari dan 1.000.000 per bulan.</p>}
        </> : <>
          <p className={styles.description}>Batas ini berlaku untuk seluruh bisnis di workspace. Kosongkan kolom untuk mengikuti paket.</p>
          <dl className={settings.effective}>{limitFields.map(({ key, label }) => <div key={key}>
            <dt>{label} saat ini</dt><dd>{displayLimit(data.effectiveQuota[key])}</dd>
          </div>)}</dl>
          <LimitInputs values={workspaceLimits} workspace noDraftLimit={noDraftLimit} setNoDraftLimit={setNoDraftLimit} onChange={(key, value) => setWorkspaceLimits(current => ({ ...current, [key]: value }))} />
          {invalidWorkspace && <p role="status" className={styles.error}>Gunakan angka bulat hingga 10.000 per hari dan 1.000.000 per bulan.</p>}
        </>}
      </section>
      <div className={settings.actions}>
        {dirty && <button type="button" className={styles.button} onClick={onReset}>Batalkan perubahan</button>}
        <button type="submit" className={styles.primary} disabled={!dirty || invalid}><Save size={16} aria-hidden /> Tinjau perubahan</button>
      </div>
    </form>
    <section className={styles.panel} aria-labelledby="admin-settings-history-title">
      <h2 id="admin-settings-history-title">Riwayat perubahan</h2>
      {data.audit.length ? <ol className={settings.audit}>
        {data.audit.map(entry => <li key={entry.id}>
          <div>
            <strong>Revisi {entry.revision}{entry.action === 'restore' && ` · Pemulihan dari revisi ${entry.restoredFrom}`}</strong>
            <span className={styles.meta}>{entry.actor} · {dateTime.format(entry.at)} WIB</span>
            <p>{entry.reason}</p>
            {!!entry.changes?.length && <ul className={settings.summary}>{entry.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
          </div>
          {entry.revision < data.revision && <button type="button" className={styles.button} disabled={dirty}
            onClick={() => setConfirmation({ restoreRevision: entry.revision })}><History size={16} aria-hidden /> Pulihkan revisi {entry.revision}</button>}
        </li>)}
      </ol> : <p className={styles.empty}>Belum ada perubahan tersimpan.</p>}
      {data.revision > 0 && <button type="button" className={styles.link} disabled={dirty}
        onClick={() => setConfirmation({ restoreRevision: 0 })}><History size={16} aria-hidden /> Pulihkan pengaturan awal</button>}
      {dirty && data.revision > 0 && <p className={styles.meta}>Simpan atau batalkan perubahan sebelum memulihkan revisi.</p>}
    </section>
    {confirmation && <SettingsConfirmation scope={scope} revision={data.revision} change={confirmation} summary={summary}
      close={() => setConfirmation(null)} save={async reason => {
        const body: AdminSettingsUpdate = {
          ...(workspace ? { workspaceId: workspace } : {}),
          expectedRevision: data.revision, reason, ...confirmation,
        };
        await request(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
        onDirty(false);
        setConfirmation(null);
        onSaved(confirmation.restoreRevision !== undefined);
      }} />}
  </>;
}
