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
    <div data-client-ready={hydrated} className="min-h-dvh bg-white text-neutral-900 flex flex-col justify-between">
      {/* Top Minimalist Global Header — 1-row sleek layout on Mobile & Desktop */}
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] flex-nowrap items-center justify-between gap-2 px-3.5 py-3 sm:px-8 sm:py-3.5 lg:px-12">
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/"
              data-testid="dedicated-header-home-link"
              className="flex items-center gap-2.5 group shrink-0"
            >
              <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-2xl bg-[#EC749B] font-black text-white shadow-xs transition group-hover:bg-[#DF608A]">
                V
              </div>
              <span className="text-base sm:text-xl font-black tracking-tight text-neutral-900 whitespace-nowrap">
                VELOXA AI
              </span>
            </Link>

            <Link
              href="/"
              data-testid="dedicated-back-to-landing-link"
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 shadow-2xs transition hover:border-pink-200 hover:text-[#D85A88]"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#EC749B]" />
              <span>Kembali ke Landing Page</span>
            </Link>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <label htmlFor="veloxa-dedicated-lang-select" className="sr-only">
              Pilih Bahasa & Mata Uang
            </label>
            <select
              id="veloxa-dedicated-lang-select"
              data-testid="dedicated-lang-select"
              value={locale}
              onChange={(e) => handleSelectLocale(e.target.value as VeloxaLocale)}
              className="max-w-[130px] sm:max-w-none truncate rounded-xl sm:rounded-2xl border border-neutral-200 bg-white px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-black text-neutral-800 shadow-2xs hover:border-pink-200 focus:border-[#EC749B] focus:outline-hidden"
            >
              {VELOXA_LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.label} ({loc.currencyCode})
                </option>
              ))}
            </select>

            {activePage !== 'login' && (
              <Link
                href="/login"
                data-testid="dedicated-nav-login-link"
                className="rounded-xl sm:rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs font-bold text-neutral-800 shadow-2xs transition hover:border-pink-200 hover:text-[#D85A88] whitespace-nowrap"
              >
                {locale === 'id' ? 'Masuk' : 'Sign In'}
              </Link>
            )}

            {activePage !== 'register' && (
              <Link
                href="/register"
                data-testid="dedicated-nav-register-link"
                className="hidden sm:inline-flex rounded-2xl bg-[#EC749B] px-4 py-2 text-xs font-black text-white shadow-xs transition hover:bg-[#DF608A] whitespace-nowrap"
              >
                {locale === 'id' ? 'Daftarkan Bisnis' : 'Launch Your Brand'}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Dedicated Page Content */}
      <main className={`mx-auto w-full ${maxWidthClass} flex-1 px-4 py-6 sm:px-8 sm:py-12 lg:px-12`}>
        {/* Mobile Back to Landing Pill */}
        <div className="mb-5 md:hidden">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 shadow-2xs"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#EC749B]" />
            <span>{locale === 'id' ? 'Kembali ke Beranda Veloxa AI' : 'Back to Veloxa AI Home'}</span>
          </Link>
        </div>

        {pageTitle && (
          <div className="mb-8 max-w-3xl space-y-3">
            {pageBadge && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FBCFE0] bg-[#FFF0F5] px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#EC749B]">
                ✨ {pageBadge}
              </span>
            )}
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-neutral-900 leading-tight">
              {pageTitle}
            </h1>
            {pageSubtitle && (
              <p className="text-xs sm:text-base text-neutral-600 leading-relaxed">
                {pageSubtitle}
              </p>
            )}
          </div>
        )}

        {children}
      </main>

      {/* Bottom Legal & Navigation Footer */}
      <footer className="border-t border-neutral-200/80 bg-white py-6 text-xs text-neutral-500">
        <div className="mx-auto flex max-w-[1480px] flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-8 lg:px-12">
          <div className="flex items-center gap-2 font-semibold text-neutral-600 text-center sm:text-left">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#EC749B]" />
            <span>© 2026 Veloxa AI Inc. · PT Veloxa Kreasi AI Global. Seluruh hak cipta dilindungi.</span>
          </div>
          <nav
            aria-label="Tautan Halaman Resmi Veloxa AI"
            className="flex flex-wrap items-center justify-center gap-4 font-bold"
          >
            <Link href="/" className="hover:text-[#D85A88]">
              Beranda
            </Link>
            <Link
              href="/login"
              className={activePage === 'login' ? 'text-[#EC749B]' : 'hover:text-[#D85A88]'}
            >
              Halaman Login
            </Link>
            <Link
              href="/register"
              className={activePage === 'register' ? 'text-[#EC749B]' : 'hover:text-[#D85A88]'}
            >
              Registrasi Bisnis
            </Link>
            <Link
              href="/forgot-password"
              className={activePage === 'forgot-password' ? 'text-[#EC749B]' : 'hover:text-[#D85A88]'}
            >
              Lupa Password
            </Link>
            <Link
              href="/terms"
              data-testid="footer-link-terms"
              className={activePage === 'terms' ? 'text-[#EC749B]' : 'hover:text-[#D85A88]'}
            >
              Terms of Use
            </Link>
            <Link
              href="/privacy"
              data-testid="footer-link-privacy"
              className={activePage === 'privacy' ? 'text-[#EC749B]' : 'hover:text-[#D85A88]'}
            >
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export default VeloxaDedicatedPageShell;
