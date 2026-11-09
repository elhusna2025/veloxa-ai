'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import {
  VELOXA_LOCALES,
  loadSavedVeloxaLocale,
  saveVeloxaLocale,
  type VeloxaLocale,
} from '@/lib/veloxa-i18n';

export interface VeloxaDedicatedPageShellProps {
  children: React.ReactNode;
  activePage?: 'login' | 'register' | 'forgot-password' | 'terms' | 'privacy';
  locale?: VeloxaLocale;
  onLocaleChange?: (locale: VeloxaLocale) => void;
  pageBadge?: string;
  pageTitle?: string;
  pageSubtitle?: string;
  maxWidthClass?: string;
}

export function VeloxaDedicatedPageShell({
  children,
  activePage,
  locale: externalLocale,
  onLocaleChange,
  pageBadge,
  pageTitle,
  pageSubtitle,
  maxWidthClass = 'max-w-[1480px]',
}: VeloxaDedicatedPageShellProps) {
  const [hydrated, setHydrated] = useState(false);
  const [internalLocale, setInternalLocale] = useState<VeloxaLocale>('id');
  const locale = externalLocale ?? internalLocale;

  useEffect(() => {
    setHydrated(true);
    const saved = loadSavedVeloxaLocale();
    setInternalLocale(saved);
    onLocaleChange?.(saved);
  }, [onLocaleChange]);

  const handleSelectLocale = (nextLocale: VeloxaLocale) => {
    setInternalLocale(nextLocale);
    saveVeloxaLocale(nextLocale);
    onLocaleChange?.(nextLocale);
  };

  return (
    <div data-client-ready={hydrated} className="veloxa-dedicated min-h-dvh bg-[#f6f7f9] text-neutral-900 flex flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
          <Link href="/" data-testid="dedicated-header-home-link" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-lg bg-neutral-950 text-base text-white">v</span>Veloxa<span className="text-[#a92e5d]">.</span></Link>
          <div className="flex items-center gap-4"><label className="sr-only" htmlFor="veloxa-dedicated-lang-select">Pilih Bahasa & Mata Uang</label><select id="veloxa-dedicated-lang-select" data-testid="dedicated-lang-select" value={locale} onChange={event=>handleSelectLocale(event.target.value as VeloxaLocale)} className="max-w-[96px] rounded-lg border border-neutral-200 bg-white px-2 py-2 text-base">{VELOXA_LOCALES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select>{activePage!=='login'&&<Link href="/login" data-testid="dedicated-nav-login-link" className="text-base font-medium text-neutral-700">{locale==='id'?'Masuk':'Sign in'}</Link>}{activePage==='login'&&<Link href="/register" data-testid="dedicated-nav-register-link" className="text-base font-medium text-neutral-700">{locale==='id'?'Buat akun':'Create account'}</Link>}</div>
        </div>
      </header>
      <main className={`mx-auto w-full ${maxWidthClass} flex-1 px-5 py-10 sm:px-8 sm:py-14`}>
        {pageTitle&&<div className={`mb-8 space-y-3 ${activePage==='forgot-password'?'mx-auto max-w-[560px]':'max-w-3xl'}`}>
          {pageBadge&&<p className="text-base font-medium text-[#a92e5d]">{pageBadge}</p>}
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{pageTitle}</h1>
          {pageSubtitle&&<p className="text-base leading-relaxed text-neutral-500">{pageSubtitle}</p>}
        </div>}
        {children}
      </main>
      <footer className="px-5 py-7 text-base text-neutral-500"><div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4"><span>© {new Date().getFullYear()} Veloxa AI</span><nav aria-label="Tautan Halaman Resmi Veloxa AI" className="flex flex-wrap gap-5"><Link href="/" data-testid="dedicated-back-to-landing-link">{locale==='id'?'Beranda':'Home'}</Link><Link href="/terms" data-testid="footer-link-terms">{locale==='id'?'Ketentuan':'Terms'}</Link><Link href="/privacy" data-testid="footer-link-privacy">{locale==='id'?'Privasi':'Privacy'}</Link></nav></div></footer>
    </div>
  );
}

export default VeloxaDedicatedPageShell;
