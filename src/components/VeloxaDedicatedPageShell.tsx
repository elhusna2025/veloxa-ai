'use client';
import { VeloxaPublicHeader } from '@/components/VeloxaPublicHeader';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import authStyles from './VeloxaAuthScreen.module.css';
import styles from './VeloxaDedicatedPageShell.module.css';
import {
  loadSavedVeloxaLocale,
  saveVeloxaLocale,
  type VeloxaLocale,
} from '@/lib/veloxa-i18n';

export interface VeloxaDedicatedPageShellProps {
  children: React.ReactNode;
  activePage: 'forgot-password' | 'terms' | 'privacy' | 'onboarding';
  locale?: VeloxaLocale;
  onLocaleChange?: (locale: VeloxaLocale) => void;
  pageTitle?: string;
  pageSubtitle?: string;
}

export function VeloxaDedicatedPageShell({
  children,
  activePage,
  locale: externalLocale,
  onLocaleChange,
  pageTitle,
  pageSubtitle,
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

  const onboarding = activePage === 'onboarding';
  const isId = locale === 'id';
  const mainClass = onboarding ? styles.onboarding : activePage === 'forgot-password' ? styles.recovery : styles.document;
  return (
    <div data-client-ready={hydrated} className={authStyles.screen}
      lang={onboarding ? locale : undefined} dir={onboarding ? (locale === 'ar' ? 'rtl' : 'ltr') : undefined}>
      <header className={authStyles.header}>
        <VeloxaPublicHeader locale={locale} onLocale={handleSelectLocale} authPage={onboarding ? "onboarding" : "support"} />
      </header>
      <main className={mainClass} lang={onboarding ? locale : isId ? 'id' : 'en'}>
        {pageTitle && <div className={authStyles.intro}>
          <h1>{pageTitle}</h1>
          {pageSubtitle && <p>{pageSubtitle}</p>}
        </div>}
        {children}
      </main>
      {!onboarding && <footer className={styles.footer} lang={isId ? 'id' : 'en'}>
        <nav aria-label={isId ? 'Tautan Veloxa' : 'Veloxa links'}>
          <Link href="/" data-testid="dedicated-back-to-landing-link">{isId ? 'Beranda' : 'Home'}</Link>
          <Link href="/terms/" data-testid="footer-link-terms" aria-current={activePage === 'terms' ? 'page' : undefined}>
            {isId ? 'Ketentuan' : 'Terms'}
          </Link>
          <Link href="/privacy/" data-testid="footer-link-privacy" aria-current={activePage === 'privacy' ? 'page' : undefined}>
            {isId ? 'Privasi' : 'Privacy'}
          </Link>
        </nav>
      </footer>}
    </div>
  );
}

export default VeloxaDedicatedPageShell;
