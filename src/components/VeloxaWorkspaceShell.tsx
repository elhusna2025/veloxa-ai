'use client';
import {VeloxaSelect} from '@/components/VeloxaSelect';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Camera, CalendarDays, ChevronRight, LayoutDashboard, Link2, LogOut, Megaphone, Plus, RefreshCw, UserRound, Wand2 } from 'lucide-react';
import { VELOXA_LOCALES, type VeloxaLocale } from '@/lib/veloxa-i18n';

export type WorkspaceTab = 'overview' | 'brand_vault' | 'studio' | 'autonomy' | 'meta_ads';
const navigation = [
  { id: 'overview', label: 'Beranda', icon: LayoutDashboard, description: 'Ringkasan aktivitas workspace Anda.' },
  { id: 'brand_vault', label: 'Profil & aset', icon: Camera, description: 'Identitas bisnis, referensi, dan koleksi media.' },
  { id: 'studio', label: 'Content Studio', icon: Wand2, description: 'Buat, tinjau, dan terbitkan konten Anda.' },
  { id: 'autonomy', label: 'Jadwal konten', icon: CalendarDays, description: 'Atur rencana dan frekuensi konten.' },
  { id: 'meta_ads', label: 'Meta Ads', icon: Megaphone, description: 'Siapkan materi dan rencana iklan Anda.' },
] as const;
interface Props {
  children: ReactNode; activeTab: WorkspaceTab; brandName: string; planName: string;
  email: string; displayName: string; used: number; quota: number; locale: VeloxaLocale;
  onNavigate: (tab: WorkspaceTab) => void; onConnections: () => void; onCreate: () => void;
  onBilling: () => void; onAccount: () => void; onSignOut: () => void; onSync: () => void;
  onLocale: (locale: VeloxaLocale) => void; isSuperAdmin?: boolean; onAdmin: () => void;
  presetControls?: ReactNode; status?: string;
}
export function VeloxaWorkspaceShell(props: Props) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [props.activeTab]);
  const selected = navigation.find(item => item.id === props.activeTab)!;
  const quotaPercent = Math.min(100, Math.max(0, props.used / Math.max(1, props.quota) * 100));
  return <div className="veloxa-workspace min-h-dvh bg-[#f6f7f9]" data-testid="user-workspace-dashboard">
    <aside aria-label="Sidebar Navigasi Workspace" data-testid="user-workspace-sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-neutral-200 bg-white px-5 py-7 lg:flex">
      <Link href="/" className="flex items-center gap-2.5 px-2 text-xl font-semibold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-lg bg-neutral-950 text-base text-white">v</span> Veloxa<span className="text-[#b43b69]">.</span></Link>
      <div className="mt-9 border-b border-neutral-100 px-2 pb-6"><p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Bisnis aktif</p><p className="mt-2 break-words text-base font-semibold text-neutral-900">{props.brandName}</p><button type="button" onClick={()=>props.onNavigate('brand_vault')} className="mt-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">Edit profil <ArrowUpRight size={14}/></button>{props.presetControls}</div>
      <nav aria-label="Menu Utama User Workspace" className="mt-6 space-y-1.5">{navigation.map(item => <button type="button" key={item.id} data-testid={`nav-tab-${item.id}`} aria-current={props.activeTab === item.id ? 'page' : undefined} onClick={() => props.onNavigate(item.id)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${props.activeTab === item.id ? 'bg-[#f8edf2] text-[#a92e5d]' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'}`}><item.icon size={19} strokeWidth={1.7}/>{item.label}</button>)}</nav>
      <div className="mt-6 border-t border-neutral-100 pt-5"><button type="button" data-testid="header-connect-social-btn" onClick={props.onConnections} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-medium text-neutral-600 hover:bg-neutral-50"><Link2 size={19} strokeWidth={1.7}/>Akun sosial</button></div>
      <div className="mt-auto pt-8"><div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><p className="break-words text-sm font-medium text-neutral-900">{props.planName}</p><p className="mt-2 text-sm text-neutral-500">{props.used} dari {props.quota} publikasi</p><div role="progressbar" aria-label="Kuota publikasi terpakai" aria-valuemin={0} aria-valuemax={props.quota} aria-valuenow={props.used} className="mt-3 h-1.5 overflow-hidden rounded bg-neutral-200"><div className="h-full rounded bg-[#bd416e]" style={{width: `${quotaPercent}%`}}/></div><button type="button" onClick={props.onBilling} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-[#a92e5d]">Lihat paket <ChevronRight size={15}/></button></div>{props.isSuperAdmin && <button type="button" onClick={props.onAdmin} className="mt-4 w-full text-sm text-neutral-600">Kembali ke Super Admin</button>}</div>
    </aside>
    <div className="min-w-0 lg:pl-60" data-testid="user-workspace-main">
      <header data-testid="workspace-right-header" className="border-b border-neutral-200 bg-white px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between sm:gap-4">
          <div className="min-w-0"><p className="mb-1 break-words text-sm text-neutral-500">{props.brandName}</p><h1 className="text-2xl font-semibold tracking-tight text-neutral-950 sm:text-[28px]">{selected.label}</h1></div>
          <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={props.onConnections} aria-label="Akun sosial" className="veloxa-button-secondary lg:hidden"><Link2 size={17}/><span className="hidden sm:inline">Akun sosial</span></button><button type="button" onClick={props.onCreate} aria-label="Buat konten" className="veloxa-button-primary"><Plus size={18}/><span className="sm:hidden">Buat</span><span className="hidden sm:inline">Buat konten</span></button><button type="button" onClick={props.onAccount} aria-label={`Profil akun ${props.email}`} className="grid h-11 w-11 place-items-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50"><UserRound size={19}/></button><button type="button" onClick={props.onSignOut} aria-label="Keluar" className="hidden h-11 w-11 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-50 sm:grid"><LogOut size={18}/></button></div>
        </div>
      </header>
      <div className="mx-auto max-w-[1480px] space-y-7 px-5 py-7 pb-10 sm:px-8 lg:px-10 lg:py-9">
        {props.status && <div role="status" aria-live="polite" className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-600">{props.status}</div>}
        {props.children}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200 pt-6 text-sm text-neutral-500"><span>Veloxa AI</span><div className="flex flex-wrap items-center gap-4"><button type="button" data-testid="local-first-sync-btn" onClick={props.onSync} className="inline-flex items-center gap-1.5 hover:text-neutral-900"><RefreshCw size={14}/>Sinkronkan</button><label className="sr-only" htmlFor="workspace-locale">Bahasa workspace</label><VeloxaSelect fullWidth={false} id="workspace-locale" aria-label="Pilih Bahasa Workspace" value={props.locale} onValueChange={event => props.onLocale(event as VeloxaLocale)} className="max-w-40 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm">{VELOXA_LOCALES.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</VeloxaSelect><Link href="/privacy" className="hover:text-neutral-900">Privasi</Link></div></footer>
      </div>
    </div>
  </div>;
}
