'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, Facebook, Instagram, Loader2 } from 'lucide-react';
import { BusinessCategoryPicker } from '@/components/BusinessCategoryPicker';
import { VeloxaDedicatedPageShell } from '@/components/VeloxaDedicatedPageShell';
import { completeVeloxaOnboarding, subscribeToFirebaseAuthChanges } from '@/lib/veloxa-auth';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import { landingCopy } from '@/lib/veloxa-public-copy';
import { onboardingCopy } from '@/lib/veloxa-onboarding-copy';
import type { VeloxaLocale } from '@/lib/veloxa-i18n';
import type { BusinessCategory, SubscriptionPlanId } from '@/lib/veloxa-types';
import authStyles from '@/components/VeloxaAuthScreen.module.css';
import styles from './page.module.css';

const channels = [
  { id: 'instagram', Icon: Instagram },
  { id: 'facebook', Icon: Facebook },
] as const;
type Channel = (typeof channels)[number]['id'];
type Step = 1 | 2 | 3;

type OnboardingError = 'businessRequired' | 'channelRequired' | 'saveError';

export default function VeloxaOnboardingWizardPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<VeloxaLocale>('id');
  const [step, setStep] = useState<Step>(1);
  const [session, setSession] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [businessName, setBusinessName] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState<BusinessCategory>('custom');
  const [targetAudience, setTargetAudience] = useState('');
  const [brandTone, setBrandTone] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>(['instagram', 'facebook']);
  const [planId, setPlanId] = useState<SubscriptionPlanId>('free_trial');
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false);
  const [error, setError] = useState<OnboardingError | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const sessionUid = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const businessNameInput = useRef<HTMLInputElement>(null);
  const cityInput = useRef<HTMLInputElement>(null);

  const copy = onboardingCopy[locale];
  const number = new Intl.NumberFormat(locale, locale === 'ar' ? { numberingSystem: 'arab' } : undefined);
  const channelNames = { instagram: 'Instagram', facebook: copy.facebookPage };

  useEffect(() => subscribeToFirebaseAuthChanges(user => {
    if (!user) {
      setSession('signed-out');
      return;
    }

    if (sessionUid.current !== user.uid) {
      sessionUid.current = user.uid;
      const existing = user.onboardingCompleted;
      setStep(1);
      setError(null);
      setAlreadyOnboarded(Boolean(existing));
      setBusinessName(existing ? user.businessName ?? '' : '');
      setCity(existing ? user.city ?? '' : '');
      setCategory(existing ? user.category ?? 'custom' : 'custom');
      setTargetAudience(existing ? user.targetAudience ?? '' : '');
      setBrandTone(existing ? user.brandTone ?? '' : '');
      const supported = channels.map(channel => channel.id).filter(id => user.selectedChannels?.includes(id));
      setSelectedChannels(supported.length ? supported : channels.map(channel => channel.id));
      setPlanId(user.subscriptionPlanId ?? 'free_trial');
    }
    setSession('ready');
  }, () => setSession('error')), []);

  useEffect(() => {
    if (session === 'signed-out') router.replace('/login/');
  }, [router, session]);

  useEffect(() => {
    if (session === 'ready') heading.current?.focus();
  }, [session, step]);

  useEffect(() => {
    if (error === 'businessRequired') {
      const invalid = businessNameInput.current?.value.trim() ? cityInput.current : businessNameInput.current;
      invalid?.focus();
    } else if (error) {
      errorNotice.current?.focus();
    }
  }, [error]);

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session !== 'ready' || savingRef.current) return;

    if (!businessName.trim() || !city.trim()) {
      setStep(1);
      setError('businessRequired');
      return;
    }
    if (step === 1) {
      goTo(2);
      return;
    }
    if (!selectedChannels.length) {
      setStep(2);
      setError('channelRequired');
      return;
    }
    if (step === 2) {
      goTo(3);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await completeVeloxaOnboarding({ businessName, city, category, targetAudience, brandTone, selectedChannels, planId });
      router.push('/');
    } catch {
      setError('saveError');
      setSaving(false);
      savingRef.current = false;
    }
  }

  const current = copy.steps[step - 1];
  const missingName = error === 'businessRequired' && !businessName.trim();
  const missingCity = error === 'businessRequired' && !city.trim();
  const trial = planId === 'free_trial';
  const plan = SUBSCRIPTION_PLANS[planId] ?? SUBSCRIPTION_PLANS.free_trial;

  return (
    <VeloxaDedicatedPageShell activePage="onboarding" locale={locale} onLocaleChange={setLocale}>
      {session !== 'ready' ? (
        session === 'error' ? (
          <div className={styles.session}>
            <h1>{copy.sessionTitle}</h1>
            <p role="alert">{copy.sessionError}</p>
            <Link href="/login/" className={authStyles.primary}>{landingCopy[locale].signIn}</Link>
          </div>
        ) : <p className={styles.sessionStatus} role="status"><Loader2 size={18} className={authStyles.spinner} aria-hidden="true" />{copy.sessionLoading}</p>
      ) : (
        <div data-testid="veloxa-onboarding-wizard-page">
          <ol className={styles.progress} aria-label={copy.progress}>
            {copy.steps.map(({ label }, index) => (
              <li key={index} aria-current={index === step - 1 ? 'step' : undefined} data-complete={index < step - 1}>
                <span>{index < step - 1 ? <Check size={13} role="img" aria-label={copy.done} /> : number.format(index + 1)}</span>{label}
              </li>
            ))}
          </ol>

          <form noValidate onSubmit={handleSubmit} className={styles.wizard}>
            <div className={styles.body}>
              <div className={authStyles.intro}>
                <h1 ref={heading} tabIndex={-1} className={styles.heading}>{current.title}</h1>
                <p>{current.description}</p>
              </div>
              {alreadyOnboarded && (
                <Link href="/" className={styles.dashboardLink} data-testid="onboarding-skip-to-dashboard-btn">{copy.dashboard}</Link>
              )}
              {error && <p id="onboarding-error" className={authStyles.error} ref={errorNotice} tabIndex={-1} role="alert">
                <CircleAlert size={18} aria-hidden="true" />{copy[error]}
              </p>}

              {step === 1 && (
                <section data-testid="onboarding-step-1-panel" className={styles.fields} aria-label={copy.businessInfo}>
                  <div className={authStyles.field}>
                    <label htmlFor="onboard-business-name">{copy.businessName}</label>
                    <div className={authStyles.control}>
                      <input ref={businessNameInput} id="onboard-business-name" data-testid="onboard-business-name-input" autoComplete="organization" dir="auto"
                        required maxLength={110} enterKeyHint="next" value={businessName}
                        aria-invalid={missingName || undefined}
                        aria-describedby={missingName ? 'onboarding-error' : undefined}
                        onChange={event => setBusinessName(event.target.value)} />
                    </div>
                  </div>
                  <div className={authStyles.field}>
                    <label htmlFor="onboard-city">{copy.city}</label>
                    <div className={authStyles.control}>
                      <input ref={cityInput} id="onboard-city" data-testid="onboard-city-input" autoComplete="address-level2" dir="auto"
                        required maxLength={80} enterKeyHint="next" value={city}
                        aria-invalid={missingCity || undefined}
                        aria-describedby={missingCity ? 'onboarding-error' : undefined}
                        onChange={event => setCity(event.target.value)} />
                    </div>
                  </div>
                  <BusinessCategoryPicker value={category} onChange={setCategory} locale={locale} />
                  <details className={styles.optional}>
                    <summary>{copy.preferences} <span>{copy.optional}</span><ChevronDown size={18} aria-hidden="true" /></summary>
                    <div className={styles.fields}>
                      <div className={authStyles.field}>
                        <label htmlFor="onboard-audience">{copy.audience}</label>
                        <div className={authStyles.control}>
                          <input id="onboard-audience" maxLength={1000} enterKeyHint="next" value={targetAudience} dir="auto"
                            onChange={event => setTargetAudience(event.target.value)} />
                        </div>
                      </div>
                      <div className={authStyles.field}>
                        <label htmlFor="onboard-tone">{copy.tone}</label>
                        <div className={authStyles.control}>
                          <input id="onboard-tone" maxLength={250} enterKeyHint="done" value={brandTone} dir="auto"
                            onChange={event => setBrandTone(event.target.value)} />
                        </div>
                      </div>
                    </div>
                  </details>
                </section>
              )}

              {step === 2 && (
                <fieldset data-testid="onboarding-step-2-panel" className={styles.choices}>
                  <legend className="sr-only">{current.title}</legend>
                  {channels.map(({ id, Icon }) => (
                    <label className={styles.choice} key={id}>
                      <span className={styles.channelIcon}><Icon size={20} aria-hidden="true" /></span>
                      <bdi>{channelNames[id]}</bdi>
                      <input type="checkbox" checked={selectedChannels.includes(id)} data-testid={`onboard-channel-${id}`}
                        onChange={event => {
                          const checked = event.currentTarget.checked;
                          setError(null);
                          setSelectedChannels(currentChannels => checked
                            ? [...currentChannels, id]
                            : currentChannels.filter(channel => channel !== id));
                        }} />
                    </label>
                  ))}
                </fieldset>
              )}

              {step === 3 && (
                <section data-testid="onboarding-step-3-panel" className={styles.review} aria-label={copy.review}>
                  <dl>
                    <div><dt>{copy.steps[0].label}</dt><dd><bdi>{businessName.trim()}</bdi></dd></div>
                    <div><dt>{copy.area}</dt><dd><bdi>{city.trim()}</bdi></dd></div>
                    <div><dt>{copy.steps[1].label}</dt><dd>
                      {new Intl.ListFormat(locale, { type: 'conjunction' }).format(channels
                        .filter(channel => selectedChannels.includes(channel.id)).map(channel => channelNames[channel.id]))}
                    </dd></div>
                  </dl>
                  <div className={styles.plan} data-testid={`onboard-plan-${plan.id}`}>
                    <h2>{trial ? copy.trial : plan.name}</h2>
                    {trial && <p>{copy.trialDetails(number.format(7), number.format(plan.monthlyPostQuota))}</p>}
                  </div>
                </section>
              )}
            </div>

            <div className={styles.actions}>
              {step > 1 && (
                <button type="button" className={authStyles.secondary} disabled={saving}
                  onClick={() => goTo(step === 3 ? 2 : 1)}><ArrowLeft size={18} className={styles.arrow} aria-hidden="true" />{copy.back}</button>
              )}
              <button type="submit" className={authStyles.primary} disabled={saving}
                data-testid={step === 3 ? 'onboarding-finish-btn' : `onboarding-next-to-step-${step + 1}`}>
                {step === 3 ? (saving ? copy.saving : copy.finish) : copy.next}
                {saving ? <Loader2 size={18} className={authStyles.spinner} aria-hidden="true" /> : <ArrowRight size={18} className={styles.arrow} aria-hidden="true" />}
              </button>
              <span role="status" className={`sr-only ${styles.savingStatus}`}>{saving ? copy.saving : ''}</span>
            </div>
          </form>
        </div>
      )}
    </VeloxaDedicatedPageShell>
  );
}
