'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { CalendarDays, CheckCircle2, Facebook, Instagram, Link2, Pause, Play, RotateCcw, Send, Sparkles } from 'lucide-react';
import { workflowCopy } from '@/lib/veloxa-public-workflow-copy';
import type { VeloxaLocale } from '@/lib/veloxa-i18n';
import styles from './VeloxaWorkflowDemo.module.css';

const stepIcons = [Link2, Sparkles, CalendarDays, Send] as const;
const lastStep = stepIcons.length - 1;

export function VeloxaWorkflowDemo({ locale, image }: { locale: VeloxaLocale; image: string }) {
  const copy = workflowCopy[locale];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [title, description] = copy.screens[step];
  const finished = step === lastStep;
  const PlaybackIcon = playing ? Pause : finished ? RotateCcw : Play;

  useEffect(() => {
    if (!playing || finished) return;
    const timer = window.setTimeout(() => {
      setStep(step + 1);
      if (step + 1 === lastStep) setPlaying(false);
    }, 5200);
    return () => window.clearTimeout(timer);
  }, [finished, playing, step]);

  function togglePlayback() {
    if (finished) setStep(0);
    setPlaying(!playing);
  }

  return (
    <section className={styles.demo} aria-labelledby="veloxa-workflow-label">
      <div className={styles.toolbar}>
        <h2 id="veloxa-workflow-label">{copy.demo}</h2>
        <button type="button" className={styles.play} onClick={togglePlayback}>
          <PlaybackIcon size={16} aria-hidden="true" />
          {playing ? copy.pause : finished ? copy.replay : copy.play}
        </button>
      </div>

      <div className={styles.steps} role="group" aria-label={copy.demo}>
        {stepIcons.map((Icon, index) => (
          <button key={index} type="button" aria-pressed={index === step} aria-controls="veloxa-workflow-screen" onClick={() => {
            setPlaying(false);
            setStep(index);
          }}>
            <Icon size={18} aria-hidden="true" />
            <span>{copy.steps[index]}</span>
          </button>
        ))}
      </div>

      <div id="veloxa-workflow-screen" className={styles.screen} aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
        <div key={step} className={styles.scene} data-step={step}>
          <h3>{title}</h3>
          <p className={styles.description}>{description}</p>

          {step === 0 && (
            <ul className={styles.accountList}>
              <li><Instagram size={20} aria-hidden="true" /><div><strong>Instagram</strong><span dir="ltr">@ronacoffee</span></div><CheckCircle2 size={18} aria-hidden="true" /></li>
              <li><Facebook size={20} aria-hidden="true" /><div><strong>Facebook Page</strong><span>Rona Coffee</span></div><CheckCircle2 size={18} aria-hidden="true" /></li>
              <li className={styles.connected}><CheckCircle2 size={16} aria-hidden="true" />{copy.connected}</li>
            </ul>
          )}

          {(step === 1 || finished) && (
            <figure className={styles.post}>
              <div className={styles.photo}>
                <Image src={image} alt="" fill sizes="(max-width: 767px) 27vw, 140px" />
              </div>
              <figcaption>
                <span className={styles.handle} dir="ltr"><Instagram size={17} aria-hidden="true" /> @ronacoffee</span>
                <p>{copy.caption}</p>
                {finished && <span className={styles.published}><CheckCircle2 size={16} aria-hidden="true" />{copy.published}</span>}
              </figcaption>
            </figure>
          )}

          {step === 2 && (
            <>
              <ul className={styles.options}>
                <li><Send size={18} aria-hidden="true" /><div><strong>{copy.manual[0]}</strong><p>{copy.manual[1]}</p></div></li>
                <li><CalendarDays size={18} aria-hidden="true" /><div><strong>{copy.automatic[0]}</strong><p>{copy.automatic[1]}</p></div></li>
              </ul>
              <p className={styles.availability}>{copy.availability}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
