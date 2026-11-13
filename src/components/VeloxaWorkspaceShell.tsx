'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Camera, CalendarDays, ChevronRight, LayoutDashboard, Link2, LogOut, Megaphone, Plus, RefreshCw, UserRound, Wand2, X } from 'lucide-react';
import { VeloxaSelect } from '@/components/VeloxaSelect';
import { VeloxaSidebarButton, VeloxaWorkspaceSidebar } from './VeloxaWorkspaceSidebar';
import { VELOXA_LOCALES, type VeloxaLocale } from '@/lib/veloxa-i18n';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import styles from './VeloxaWorkspace.module.css';

export const WORKSPACE_NAVIGATION = [
  { id: 'overview', label: 'Beranda', short: 'Beranda', icon: LayoutDashboard },
  { id: 'brand_vault', label: 'Profil & aset', short: 'Profil', icon: Camera },
  { id: 'studio', label: 'Content Studio', short: 'Studio', icon: Wand2 },
  { id: 'autonomy', label: 'Jadwal konten', short: 'Jadwal', icon: CalendarDays },
  { id: 'meta_ads', label: 'Meta Ads', short: 'Meta Ads', icon: Megaphone },
] as const;
export type WorkspaceTab = typeof WORKSPACE_NAVIGATION[number]['id'];

interface Props {
  children: ReactNode; activeTab: WorkspaceTab; brandName: string; planName: string;
  email: string; used: number; quota: number; locale: VeloxaLocale;
  onNavigate: (tab: WorkspaceTab) => void; onConnections: () => void; onCreate: () => void;
  onBilling: () => void; onAccount: () => void; onSignOut: () => void; onSync: () => void;
  onLocale: (locale: VeloxaLocale) => void; isSuperAdmin?: boolean; onAdmin: () => void;
  presetControls?: ReactNode; status?: string; onDismissStatus: () => void;
}

export function VeloxaWorkspaceShell(props: Props) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [props.activeTab]);
  const { t } = useWorkspaceCopy(workspaceCatalog);
  const selected = WORKSPACE_NAVIGATION.find(item => item.id === props.activeTab)!;
  const quotaPercent = Math.min(100, Math.max(0, props.used / Math.max(1, props.quota) * 100));
  const number = new Intl.NumberFormat(props.locale);
  return <div className="veloxa-workspace min-h-dvh" data-testid="user-workspace-dashboard">
    <VeloxaWorkspaceSidebar label={t('Sidebar Navigasi Workspace')} testId="user-workspace-sidebar">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-xl font-bold tracking-tight"><span aria-hidden="true" className={`${styles.logo} grid h-9 w-9 place-items-center rounded-lg text-base`}>V</span> Veloxa<span aria-hidden="true" className="text-[var(--ws-action)]">.</span></Link>
      <div className="mt-7 border-b border-[var(--ws-border)] px-2 pb-4">
        <p className="text-xs font-medium text-[var(--ws-muted)]">{t('Bisnis aktif')}</p>
        <p dir="auto" className="mt-1 break-words text-base font-semibold">{props.brandName}</p>
        <button type="button" onClick={() => props.onNavigate('brand_vault')} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--ws-action)]">{t('Edit profil')} <ArrowUpRight size={14} aria-hidden="true"/></button>
        {props.presetControls}
      </div>
      <nav aria-label={t('Menu Utama User Workspace')} className="mt-4 space-y-1">{WORKSPACE_NAVIGATION.map(item => <VeloxaSidebarButton key={item.id} data-testid={`nav-tab-${item.id}`} aria-current={props.activeTab === item.id ? 'page' : undefined} onClick={() => props.onNavigate(item.id)}><item.icon size={19} strokeWidth={1.7} className="shrink-0" aria-hidden="true"/>{t(item.label)}</VeloxaSidebarButton>)}</nav>
      <div className="mt-4 border-t border-[var(--ws-border)] pt-3"><VeloxaSidebarButton data-testid="header-connect-social-btn" onClick={props.onConnections}><Link2 size={19} strokeWidth={1.7} aria-hidden="true"/>{t('Akun sosial')}</VeloxaSidebarButton></div>
      <div className="mt-auto pt-6"><div className={`${styles.plan} rounded-xl border p-4`}>
        <p className="break-words text-sm font-semibold">{t(props.planName)}</p>
        <p className="mt-1 text-sm text-[var(--ws-muted)]">{t('{used} dari {quota} publikasi', { used: number.format(props.used), quota: number.format(props.quota) })}</p>
        {props.quota > 0 && <div role="progressbar" aria-label={t('Kuota publikasi terpakai')} aria-valuemin={0} aria-valuemax={props.quota} aria-valuenow={Math.min(props.used, props.quota)} className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--ws-border)]"><div className="h-full rounded bg-[var(--ws-action)]" style={{width: `${quotaPercent}%`}}/></div>}
        <button type="button" onClick={props.onBilling} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[var(--ws-action)]">{t('Lihat paket')} <ChevronRight size={15} aria-hidden="true"/></button>
      </div>{props.isSuperAdmin && <button type="button" onClick={props.onAdmin} className="mt-4 w-full text-sm text-[var(--ws-muted)]">{t('Kembali ke Super Admin')}</button>}</div>
    </VeloxaWorkspaceSidebar>
    <div className={`${styles.main} min-w-0`} data-testid="user-workspace-main">
      <header data-testid="workspace-right-header" className={`${styles.header} bg-white px-4 sm:px-7 lg:px-9`}>
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2">
          <div className="min-w-0"><p dir="auto" className="mb-0.5 truncate text-[13px] text-[var(--ws-muted)]" title={props.brandName}>{props.brandName}</p><h1 className={styles.headerTitle}>{t(selected.label)}</h1></div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className={styles.language}><VeloxaSelect fullWidth={false} id="workspace-locale" aria-label={t('Pilih Bahasa Workspace')} value={props.locale} onValueChange={value => props.onLocale(value as VeloxaLocale)} className="w-[68px] !gap-1" popupMinWidth={158} displayValue={props.locale.toUpperCase()}>{VELOXA_LOCALES.map(item => <option key={item.code} value={item.code}>{item.nativeName}</option>)}</VeloxaSelect></div>
            {props.activeTab !== 'overview' && props.activeTab !== 'studio' && <button type="button" onClick={props.onCreate} aria-label={t('Buat konten')} className="veloxa-button-primary !px-2.5 sm:!px-4"><Plus size={18} aria-hidden="true"/><span className="hidden sm:inline">{t('Buat konten')}</span></button>}
            <button type="button" onClick={props.onAccount} aria-label={`${t('Profil akun')} ${props.email}`} className={`${styles.iconButton} grid h-11 w-11 place-items-center rounded-lg`}><UserRound size={19} aria-hidden="true"/></button>
            <button type="button" onClick={props.onSignOut} aria-label={t('Keluar')} className="hidden h-11 w-11 place-items-center rounded-lg text-[var(--ws-muted)] hover:bg-[var(--ws-soft)] sm:grid"><LogOut size={18} aria-hidden="true"/></button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-4 sm:px-7 sm:py-6 lg:px-9">
        {props.status && <div role="status" aria-live="polite" className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ws-border)] bg-white px-3 py-1 text-sm leading-relaxed text-[var(--ws-muted)]"><span>{t(props.status)}</span><button type="button" onClick={props.onDismissStatus} aria-label={t("Tutup pemberitahuan")} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--ws-action)] hover:bg-[var(--ws-soft)]"><X size={17} aria-hidden="true"/></button></div>}
        {props.children}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ws-border)] pt-4 text-sm text-[var(--ws-muted)]"><span>Veloxa AI</span><div className="flex flex-wrap items-center gap-4"><button type="button" data-testid="local-first-sync-btn" onClick={props.onSync} className="inline-flex items-center gap-1.5 hover:text-[var(--ws-action)]"><RefreshCw size={14} aria-hidden="true"/>{t('Sinkronkan')}</button><Link href="/privacy" className="hover:text-[var(--ws-action)]">{t('Privasi')}</Link></div></footer>
      </div>
    </div>
  </div>;
}
