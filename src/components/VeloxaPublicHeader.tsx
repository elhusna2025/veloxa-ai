'use client';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { VeloxaSelect } from '@/components/VeloxaSelect';
import { VELOXA_LOCALES, type VeloxaLocale } from '@/lib/veloxa-i18n';
import { landingCopy } from '@/lib/veloxa-public-copy';
import { authCopy } from '@/lib/veloxa-auth-copy';

const sections = ['cara-kerja', 'contoh', 'hemat', 'harga'] as const;

export function VeloxaPublicHeader({ locale, onLocale, authPage }: {
  locale: VeloxaLocale;
  onLocale: (locale: VeloxaLocale) => void;
  authPage?: 'login' | 'register' | 'support' | 'onboarding';
}) {
  const copy = landingCopy[locale];
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const languageId = authPage ? 'veloxa-dedicated-lang-select' : 'veloxa-global-lang-select';
  const alternateAccountAction = authPage === 'login'
    ? { href: '/register/', label: authCopy[locale].signUp, testId: 'dedicated-nav-register-link' }
    : { href: '/login/', label: copy.signIn, testId: 'dedicated-nav-login-link' };

  return (
    <div lang={locale} dir={direction} className="mx-auto flex w-[calc(100%-max(20px,env(safe-area-inset-left))-max(20px,env(safe-area-inset-right)))] max-w-[1250px] items-center justify-between gap-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:w-[calc(100%-56px)] md:pb-3.5 md:pt-[calc(0.875rem+env(safe-area-inset-top))] min-[1041px]:w-[calc(100%-96px)]">
      <a href={authPage ? '/' : '/#veloxa-landing-top'} data-testid={authPage ? 'dedicated-header-home-link' : undefined}
        dir="ltr" aria-label="Veloxa AI" className={`flex min-h-11 shrink-0 items-center gap-2 text-xl font-semibold tracking-tight ${authPage ? 'text-[#241421]' : 'text-[#fff1f6]'}`}>
        <span aria-hidden="true" className={`grid h-8 w-8 place-items-center rounded-lg border text-lg ${authPage ? 'border-[#682943] bg-[#682943] text-white' : 'border-[#f2afc84d] bg-[#322037] text-[#f2afc8]'}`}>v</span>
        <span>veloxa<span aria-hidden="true" className={authPage ? 'text-[#682943]' : 'text-[#f2afc8]'}>.</span></span>
      </a>
      {!authPage && <nav aria-label={copy.navigation} className="hidden items-center gap-6 text-sm font-medium text-[#e5d1df] lg:flex">
        {sections.map((id, index) => <a key={id} className="py-3 hover:text-white hover:underline hover:underline-offset-4" href={`/#${id}`}>{copy.nav[index]}</a>)}
      </nav>}
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <label className="sr-only" htmlFor={languageId}>{copy.language}</label>
        <VeloxaSelect fullWidth={false} id={languageId} data-testid={authPage ? 'dedicated-lang-select' : 'header-lang-select'}
          value={locale} onValueChange={value => onLocale(value as VeloxaLocale)}
          className={`min-h-11 w-[58px] border px-2 text-xs ${authPage ? '!border-[#e4d7dc] !text-[#682943] [&_svg]:text-[#682943]' : '!border-[#f2afc838] !bg-[#28182d] !text-[#fff1f6] [&_svg]:text-[#edc9db]'}`}>
          {VELOXA_LOCALES.map(item => <option key={item.code} value={item.code}>{item.code.toUpperCase()}</option>)}
        </VeloxaSelect>
        {authPage === 'onboarding' ? null : authPage ? (
          <Link href={alternateAccountAction.href} data-testid={alternateAccountAction.testId}
            className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-sm font-semibold text-[#682943] hover:bg-[#faedf1]">
            {alternateAccountAction.label}
          </Link>
        ) : (
          <>
            <Link href="/login/" data-testid="open-auth-modal-btn" className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-[#fff1f6] hover:bg-[#3a253e]">
              {copy.signIn}
            </Link>
            <Link href="/register/" data-testid="open-onboarding-public-btn"
              className="hidden min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[#f2afc86b] px-4 text-sm font-semibold text-[#f7c2d8] hover:bg-[#3a253e] md:inline-flex">
              {copy.tryFree}<ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
