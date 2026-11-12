'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, CircleAlert, Eye, EyeOff, Loader2, Lock, Mail, UserRound } from 'lucide-react';
import { VeloxaPublicHeader } from './VeloxaPublicHeader';
import { registerNewVeloxaAccount, signInWithEmailPasswordOrRegister, signInWithGooglePopup } from '@/lib/veloxa-auth';
import { authCopy } from '@/lib/veloxa-auth-copy';
import { loadSavedVeloxaLocale, saveVeloxaLocale, type VeloxaLocale } from '@/lib/veloxa-i18n';
import { landingCopy } from '@/lib/veloxa-public-copy';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import styles from './VeloxaAuthScreen.module.css';

type Method = 'email' | 'google';
type AuthError = 'consentRequired' | 'nameRequired' | 'passwordMismatch' | 'loginError' | 'registerError' | 'emailExists' | 'googleError';

export function VeloxaAuthScreen({ page }: { page: 'login' | 'register' }) {
  const router = useRouter();
  const register = page === 'register';
  const [locale, setLocale] = useState<VeloxaLocale>('id');
  const [ready, setReady] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState<Method | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const consent = useRef<HTMLInputElement>(null);
  const confirmPassword = useRef<HTMLInputElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const requestInProgress = useRef(false);

  const copy = authCopy[locale];
  const brand = landingCopy[locale];
  const title = register ? copy.registerTitle : copy.loginTitle;
  const action = register ? copy.signUp : brand.signIn;
  const terms = <Link href="/terms/" data-testid="footer-link-terms">{brand.terms}</Link>;
  const privacy = <Link href="/privacy/" data-testid="footer-link-privacy">{brand.privacy}</Link>;
  const actionDisabled = !ready || busy !== null || (register && !acceptedTerms);

  useEffect(() => {
    setLocale(loadSavedVeloxaLocale());
    setReady(true);
  }, []);

  useEffect(() => {
    if (error === 'consentRequired') consent.current?.focus();
    else if (error === 'passwordMismatch') confirmPassword.current?.focus();
    else if (error) errorNotice.current?.focus();
  }, [error]);

  async function authenticate(method: Method, form?: FormData) {
    if (requestInProgress.current) return;
    if (register && !consent.current?.checked) {
      setError('consentRequired');
      consent.current?.focus();
      return;
    }

    const name = String(form?.get('name') ?? '').trim();
    if (method === 'email' && register && name.length < 2) {
      setError('nameRequired');
      return;
    }

    const password = String(form?.get(register ? 'new-password' : 'password') ?? '');
    if (method === 'email' && register && password !== form?.get('confirm-password')) {
      setError('passwordMismatch');
      confirmPassword.current?.focus();
      return;
    }

    requestInProgress.current = true;
    setBusy(method);
    setError(null);
    try {
      const email = String(form?.get('email') ?? '').trim();
      const user = method === 'google'
        ? await signInWithGooglePopup(register ? { isRegistrationFlow: true } : undefined)
        : register
          ? (await registerNewVeloxaAccount({ name, email, password })).user
          : await signInWithEmailPasswordOrRegister({ email, password });

      const needsOnboarding = register ? !user.onboardingCompleted : user.onboardingCompleted === false;
      router.push(!user.isSuperAdmin && needsOnboarding ? '/onboarding/' : '/');
    } catch (cause) {
      const duplicate = typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'auth/email-already-in-use';
      setError(method === 'google' ? 'googleError' : register ? (duplicate ? 'emailExists' : 'registerError') : 'loginError');
    } finally {
      setBusy(null);
      requestInProgress.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate('email', new FormData(event.currentTarget));
  }

  function clearPasswordMismatch() {
    if (error === 'passwordMismatch') setError(null);
  }

  const googleAction = (
    <button type="button" className={styles.secondary} data-testid={register ? 'register-google-oauth-btn' : 'login-page-google-btn'}
      disabled={actionDisabled} onClick={() => void authenticate('google')}>
      <span>{busy === 'google' ? copy.busyGoogle : copy.google}</span>
      {busy === 'google'
        ? <Loader2 size={17} className={styles.spinner} aria-hidden="true" />
        : <ArrowUpRight size={17} aria-hidden="true" />}
    </button>
  );

  return (
    <div className={styles.screen} lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-client-ready={ready}>
      <header className={styles.header}>
        <VeloxaPublicHeader locale={locale} authPage={page} onLocale={value => {
          setLocale(value);
          saveVeloxaLocale(value);
        }} />
      </header>
      <main className={styles.layout} data-testid={register ? 'veloxa-dedicated-register-page' : 'dedicated-login-page'} data-mode={page}>
        <div className={styles.art} aria-hidden="true">
          <div className={styles.artCopy}>
            <p>{brand.identity}</p>
            <strong>{brand.title} <em>{brand.emphasis}</em></strong>
          </div>
        </div>
        <section className={styles.panel} aria-labelledby="veloxa-auth-title">
          <div className={styles.content}>
            <div className={styles.intro}>
              <h1 id="veloxa-auth-title">{title}</h1>
              <p>{register ? copy.registerIntro : copy.loginIntro}</p>
              {register && <p className={styles.trial}>{brand.trial(new Intl.NumberFormat(locale).format(SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota))}</p>}
            </div>
            {error && error !== 'consentRequired' && error !== 'passwordMismatch' && (
              <p ref={errorNotice} role="alert" tabIndex={-1} className={styles.error}>
                <CircleAlert size={18} aria-hidden="true" />{copy[error]}
              </p>
            )}
            <p className="sr-only" role="status">
              {busy && (busy === 'google' ? copy.busyGoogle : register ? copy.busyRegister : copy.busyLogin)}
            </p>
            {!register && <>{googleAction}<div className={styles.divider}>{copy.orEmail}</div></>}
            <form method="post" action={`/${page}/`} onSubmit={handleSubmit}
              data-testid={register ? 'register-Account-form' : 'dedicated-login-form'} className={styles.form}>
              {register && (
                <div className={styles.field}>
                  <label htmlFor="register-full-name">{copy.name}</label>
                  <div className={styles.control}>
                    <UserRound size={18} aria-hidden="true" />
                    <input id="register-full-name" name="name" type="text" dir="auto" autoComplete="name" enterKeyHint="next"
                      required minLength={2} data-testid="register-name-input" />
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <label htmlFor={`${page}-email`}>{copy.email}</label>
                <div className={styles.control}>
                  <Mail size={18} aria-hidden="true" />
                  <input id={`${page}-email`} name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
                    spellCheck={false} enterKeyHint="next" required data-testid={`${page}-email-input`} />
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor={register ? 'register-new-password' : 'login-password'}>{copy.password}</label>
                <div className={`${styles.control} ${styles.password}`}>
                  <Lock size={18} aria-hidden="true" />
                  <input id={register ? 'register-new-password' : 'login-password'} name={register ? 'new-password' : 'password'}
                    type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'}
                    autoCapitalize="none" spellCheck={false} enterKeyHint={register ? 'next' : 'done'} required minLength={6}
                    onChange={register ? clearPasswordMismatch : undefined}
                    aria-describedby={register ? 'register-password-rules' : undefined} data-testid={`${page}-password-input`} />
                  <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword(value => !value)}
                    label={showPassword ? copy.hidePassword : copy.showPassword} testId={`${page}-toggle-password-btn`} />
                </div>
                {register ? <p id="register-password-rules" className={styles.hint}>{copy.passwordRule}</p> : (
                  <Link href="/forgot-password/" className={styles.forgot} data-testid="login-to-forgot-password-link">{copy.forgot}</Link>
                )}
              </div>
              {register && (
                <div className={styles.field}>
                  <label htmlFor="register-confirm-password">{copy.confirmPassword}</label>
                  <div className={`${styles.control} ${styles.password}`}>
                    <Lock size={18} aria-hidden="true" />
                    <input ref={confirmPassword} id="register-confirm-password" name="confirm-password"
                      type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" spellCheck={false}
                      enterKeyHint="done" required onChange={clearPasswordMismatch} data-testid="register-confirm-password-input"
                      aria-invalid={error === 'passwordMismatch' || undefined}
                      aria-describedby={error === 'passwordMismatch' ? 'register-password-mismatch' : undefined} />
                    <PasswordVisibilityButton visible={showConfirmation} onToggle={() => setShowConfirmation(value => !value)}
                      label={showConfirmation ? copy.hideConfirmation : copy.showConfirmation} testId="register-toggle-confirm-password-btn" />
                  </div>
                  {error === 'passwordMismatch' && (
                    <p id="register-password-mismatch" role="alert" className={styles.fieldError}>{copy.passwordMismatch}</p>
                  )}
                </div>
              )}
              {register && (
                <div>
                  <label className={styles.consent}>
                    <input ref={consent} type="checkbox" required checked={acceptedTerms} data-testid="register-legal-checkbox"
                      aria-describedby={error === 'consentRequired' ? 'register-consent-error' : undefined}
                      onChange={event => {
                        setAcceptedTerms(event.currentTarget.checked);
                        if (event.currentTarget.checked && error === 'consentRequired') setError(null);
                      }} />
                    <span>{copy.consent(terms, privacy)}</span>
                  </label>
                  {error === 'consentRequired' && <p id="register-consent-error" role="alert" className={styles.error}>
                    <CircleAlert size={18} aria-hidden="true" />{copy.consentRequired}
                  </p>}
                </div>
              )}
              <button type="submit" className={styles.primary} data-testid={`${page}-submit-btn`} disabled={actionDisabled}>
                {busy === 'email' ? (register ? copy.busyRegister : copy.busyLogin) : action}
                {busy === 'email'
                  ? <Loader2 size={18} className={styles.spinner} aria-hidden="true" />
                  : <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </form>
            {register ? <><div className={styles.divider}>{copy.or}</div>{googleAction}</> : (
              <p className={styles.legal}>{copy.legal(terms, privacy)}</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function PasswordVisibilityButton({ visible, onToggle, label, testId }: {
  visible: boolean;
  onToggle: () => void;
  label: string;
  testId: string;
}) {
  const Icon = visible ? EyeOff : Eye;

  return (
    <button type="button" onClick={onToggle} aria-label={label} aria-pressed={visible} data-testid={testId}>
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
