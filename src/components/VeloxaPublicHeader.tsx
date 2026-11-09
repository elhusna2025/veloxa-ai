'use client';
import Link from 'next/link';
import { VELOXA_LOCALES, type VeloxaLocale } from '@/lib/veloxa-i18n';
export function VeloxaPublicHeader({locale,onLocale}:{locale:VeloxaLocale;onLocale:(locale:VeloxaLocale)=>void}) {
 return <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
  <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-semibold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-lg bg-neutral-950 text-base text-white">v</span>Veloxa<span className="text-[#a92e5d]">.</span></Link>
  <div className="flex min-w-0 items-center gap-2 sm:gap-3"><label className="sr-only" htmlFor="veloxa-global-lang-select">Pilih bahasa</label><select id="veloxa-global-lang-select" data-testid="header-lang-select" value={locale} onChange={event=>onLocale(event.target.value as VeloxaLocale)} className="w-[64px] rounded-lg border border-neutral-200 bg-white px-2 py-2 text-sm">{VELOXA_LOCALES.map(item=><option key={item.code} value={item.code}>{item.code.toUpperCase()}</option>)}</select><Link href="/login" data-testid="open-auth-modal-btn" className="rounded-lg px-2 py-2 text-sm font-medium text-neutral-700">{locale==='id'?'Masuk':'Sign in'}</Link><Link href="/register" data-testid="open-onboarding-public-btn" className="veloxa-button-primary hidden sm:inline-flex">{locale==='id'?'Mulai gratis':'Get started'}</Link></div>
 </div>;
}
