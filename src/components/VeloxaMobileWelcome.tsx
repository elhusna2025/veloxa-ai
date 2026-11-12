'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Facebook, Instagram, Pause, Play } from 'lucide-react';
import { landingCopy } from '@/lib/veloxa-public-copy';
import { workflowCopy } from '@/lib/veloxa-public-workflow-copy';
import { mobileWelcomeCopy } from '@/lib/veloxa-mobile-welcome-copy';
import type { VeloxaLocale } from '@/lib/veloxa-i18n';
import styles from './VeloxaMobileWelcome.module.css';

const scenes = ['creator', 'connect', 'create', 'schedule', 'published', 'trial'] as const;
const autoAdvanceDelay = 8000;

export function VeloxaMobileWelcome({ locale }: { locale: VeloxaLocale }) {
  const copy = mobileWelcomeCopy[locale];
  const workflow = workflowCopy[locale];
  const landing = landingCopy[locale];
  const slides = [copy.first, ...workflow.screens, copy.last];
  const last = slides.length - 1;
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const scrollSign = direction === 'rtl' ? -1 : 1;
  const format = new Intl.NumberFormat(locale);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const carousel = useRef<HTMLDivElement>(null);
  const signup = useRef<HTMLAnchorElement>(null);
  const focusSignup = useRef(false);

  useEffect(() => {
    if (active !== last || !focusSignup.current) return;

    focusSignup.current = false;
    signup.current?.focus({ preventScroll: true });
  }, [active, last]);

  const goTo = useCallback((index: number) => {
    const scroller = carousel.current;
    if (!scroller || index < 0 || index > last) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      left: index * scroller.clientWidth * scrollSign,
      behavior: reduceMotion || Math.abs(index - active) > 1 ? 'instant' : 'smooth',
    });
  }, [active, last, scrollSign]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pauseForPreference = () => {
      if (reducedMotion.matches) setPlaying(false);
    };
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    pauseForPreference();
    reducedMotion.addEventListener('change', pauseForPreference);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      reducedMotion.removeEventListener('change', pauseForPreference);
      document.removeEventListener('visibilitychange', pauseWhenHidden);
    };
  }, []);

  useEffect(() => {
    if (!playing || active >= last) return;

    const mobile = window.matchMedia('(width < 768px)');
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (mobile.matches && !document.hidden) {
        timer = window.setTimeout(() => goTo(active + 1), autoAdvanceDelay);
      }
    };
    schedule();
    mobile.addEventListener('change', schedule);
    return () => {
      window.clearTimeout(timer);
      mobile.removeEventListener('change', schedule);
    };
  }, [active, goTo, last, playing]);

  function navigate(index: number, focusTrial = false) {
    setPlaying(false);
    focusSignup.current = focusTrial && index === last;
    goTo(index);
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    navigate(active + (event.key === 'ArrowRight' ? scrollSign : -scrollSign));
  }

  const artworkDetails = [
    null,
    <span key="channels" dir="ltr">
      <Instagram size={19} aria-hidden="true" /> Instagram
      <span className={styles.separator} />
      <Facebook size={18} aria-hidden="true" /> Facebook
    </span>,
    <span key="campaign">{landing.sampleLabel}</span>,
    <span key="schedule"><CalendarDays size={17} aria-hidden="true" />{workflow.automatic[0]}</span>,
    <span key="published"><CheckCircle2 size={17} aria-hidden="true" />{workflow.published} <span className={styles.separator} /> {copy.example}</span>,
    null,
  ];

  return (
    <section className={styles.welcome} aria-label={copy.label} lang={locale} dir={direction} data-testid="veloxa-mobile-welcome"
      onFocusCapture={event => {
        if (event.target.matches(':focus-visible')) setPlaying(false);
      }}>
      <div
        className={styles.carousel}
        ref={carousel}
        tabIndex={0}
        aria-label={copy.label}
        onKeyDown={handleKey}
        onPointerDown={() => setPlaying(false)}
        onWheel={() => setPlaying(false)}
        onScroll={event => {
          const scroller = event.currentTarget;
          if (!scroller.clientWidth) return;
          const nearest = Math.round(Math.abs(scroller.scrollLeft) / scroller.clientWidth);
          setActive(Math.min(last, nearest));
        }}
      >
        {slides.map(([title, description], index) => {
          const Heading = index === 0 ? 'h1' : 'h2';
          return (
            <article className={styles.slide} key={scenes[index]} aria-hidden={index !== active}>
              <figure className={styles.artwork} data-scene={scenes[index]}>
                <Image src={`/landing/welcome/${scenes[index]}.webp`} fill priority={index === 0} sizes="(max-width: 560px) 100vw, 560px" alt="" />
                {artworkDetails[index] && <figcaption className={styles.imageCaption}>{artworkDetails[index]}</figcaption>}
              </figure>
              <div className={styles.copy}>
                {index > 0 && index < last && <p className={styles.step}>{workflow.steps[index - 1]}</p>}
                <Heading>{title}</Heading>
                <p className={styles.description}>{description}</p>
                {index === 3 && <p className={styles.note}>{workflow.availability}</p>}
                {index === last && <p className={styles.note}>{landing.trial}</p>}
              </div>
            </article>
          );
        })}
      </div>

      <div className={styles.controls}>
        <div className={styles.dots} role="group" aria-label={copy.label}>
          {slides.map(([title], index) => (
            <button key={scenes[index]} type="button" onClick={() => navigate(index)}
              aria-label={`${copy.slide} ${format.format(index + 1)} · ${title}`}
              aria-current={index === active ? 'step' : undefined}><span /></button>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.back} disabled={active === 0} aria-label={copy.back} onClick={() => navigate(active - 1)}>
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          {active === last ? (
            <Link ref={signup} className={styles.primary} href="/register/">{landing.start}<ArrowRight size={19} aria-hidden="true" /></Link>
          ) : (
            <button type="button" className={styles.primary} onClick={() => navigate(active + 1, true)}>{copy.next}<ArrowRight size={19} aria-hidden="true" /></button>
          )}
        </div>
        <div className={styles.secondary}>
          {active === last ? (
            <><Link href="/terms/">{landing.terms}</Link><Link href="/privacy/">{landing.privacy}</Link></>
          ) : (
            <>
              <button type="button" className={styles.playback}
                onClick={() => setPlaying(value => !value)}>
                {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                {playing ? copy.pause : copy.play}
              </button>
              <button type="button" onClick={() => navigate(last, true)}>{copy.skip}</button>
            </>
          )}
        </div>
        <p className="sr-only" role="status" aria-live={playing && active < last ? 'off' : 'polite'}>
          {`${copy.slide} ${format.format(active + 1)} / ${format.format(slides.length)} · ${slides[active][0]}`}
        </p>
      </div>
    </section>
  );
}
