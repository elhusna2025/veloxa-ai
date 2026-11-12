'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, Facebook, Instagram, Layers, Palette, Sparkles } from 'lucide-react';
import { VeloxaMobileWelcome } from './VeloxaMobileWelcome';
import { VeloxaSelect } from './VeloxaSelect';
import { VeloxaWorkflowDemo } from './VeloxaWorkflowDemo';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import { getPlanLocalizedPrice, VELOXA_LOCALES, type VeloxaLocale } from '@/lib/veloxa-i18n';
import { landingCopy } from '@/lib/veloxa-public-copy';
import { workflowCopy } from '@/lib/veloxa-public-workflow-copy';
import styles from './VeloxaPublicLanding.module.css';

const images = {
  studio: '/landing/creator-studio.webp',
  coffee: '/landing/coffee-launch.webp',
};

const paidPlans = [
  { id: 'starter_500k', name: 'Starter' },
  { id: 'growth_1000k', name: 'Growth' },
  { id: 'pro_1500k', name: 'Pro' },
] as const;
const initialCosts = {
  IDR: { design: '1500000', copy: '1500000', video: '750000' },
  USD: { design: '100', copy: '100', video: '50' },
  JPY: { design: '16500', copy: '16500', video: '8250' },
  KRW: { design: '150000', copy: '150000', video: '75000' },
};
const costFields = ['design', 'copy', 'video'] as const;
const featureIcons = [Palette, Sparkles, CalendarDays] as const;

function CostCalculator({ locale, currency }: { locale: VeloxaLocale; currency: keyof typeof initialCosts }) {
  const copy = landingCopy[locale];
  const [costs, setCosts] = useState(initialCosts[currency]);
  const [planId, setPlanId] = useState<(typeof paidPlans)[number]['id']>('starter_500k');
  const currentCost = costFields.reduce((total, field) => total + Number(costs[field]), 0);
  const planCost = getPlanLocalizedPrice(planId, locale).amount;
  const difference = currentCost - planCost;
  const percent = difference > 0 ? Math.floor(difference * 100 / currentCost) : 0;
  const largestCost = Math.max(currentCost, planCost);
  const format = new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  const inputCurrency = currency === 'IDR' ? 'Rp' : currency;
  const percentText = new Intl.NumberFormat(locale, { style: 'percent' }).format(percent / 100);
  const rows = [
    { label: copy.yourCosts, value: currentCost, kind: styles.currentBar },
    { label: copy.planCosts, value: planCost, kind: styles.planBar },
  ];

  return (
    <div className={styles.calculatorGrid}>
      <div className={styles.costInputs}>
        <p className={styles.help}>{copy.calculatorExample}</p>
        {costFields.map(field => (
          <label key={field} className={styles.costLabel}>
            {copy.costLabels[field]}
            <span className={styles.amountInput}>
              <span aria-hidden="true">{inputCurrency}</span>
              <input
                aria-label={`${copy.costLabels[field]} (${inputCurrency})`}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={costs[field]}
                onChange={event => {
                  const value = event.currentTarget.value.normalize('NFKC')
                    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
                    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
                    .replace(/[^0-9]/g, '').slice(0, 12);
                  setCosts(previous => ({ ...previous, [field]: value }));
                }}
              />
            </span>
          </label>
        ))}
        <label htmlFor="veloxa-compare-plan" className={styles.costLabel}>{copy.selectedPlan}</label>
        <VeloxaSelect id="veloxa-compare-plan" value={planId} className={styles.planSelect} onValueChange={value => {
          const plan = paidPlans.find(option => option.id === value);
          if (plan) setPlanId(plan.id);
        }}>
          {paidPlans.map(plan => <option key={plan.id} value={plan.id}>{`${plan.name} · ${format.format(getPlanLocalizedPrice(plan.id, locale).amount)}`}</option>)}
        </VeloxaSelect>
      </div>
      <div className={styles.costResult}>
        <div aria-live="polite" aria-atomic="true">
          <p>{difference > 0 ? copy.savings : difference < 0 ? copy.extraCost : copy.sameCost}</p>
          <output className={styles.savingsAmount}>{format.format(Math.abs(difference))}</output>
          {percent > 0 && <p className={styles.percentage}>{percentText} {copy.savingsPercent}</p>}
        </div>
        <div className={styles.bars}>
          {rows.map(({ label, value, kind }) => (
            <div key={label}>
              <div className={styles.barLabel}><span>{label}</span><strong>{format.format(value)}</strong></div>
              <div className={styles.barTrack} aria-hidden="true">
                <div className={kind} style={{ width: `${value / largestCost * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className={styles.calculatorNote}>{copy.calculatorNote}</p>
      </div>
    </div>
  );
}

export function VeloxaPublicLanding({ locale }: { locale: VeloxaLocale }) {
  const copy = landingCopy[locale];
  const workflow = workflowCopy[locale];
  const localeInfo = VELOXA_LOCALES.find(item => item.code === locale) ?? VELOXA_LOCALES[0];
  const [campaign, setCampaign] = useState(0);
  const [name, campaignTitle, brief, slides] = copy.campaigns[campaign];

  return (
    <div id="veloxa-landing-top" data-testid="veloxa-sales-landing-page" lang={locale} dir={localeInfo.dir} className={styles.landing}>
      <VeloxaMobileWelcome key={locale} locale={locale} />
      <div className={styles.desktopLanding}>
        <section className={styles.hero} aria-labelledby="veloxa-landing-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}><span aria-hidden="true" />{copy.identity}</p>
              <h1 id="veloxa-landing-title">
                <span>{copy.title}{' '}<br /><em>{copy.emphasis}</em></span>
              </h1>
              <p className={styles.heroDescription}>
                <span>{copy.description}</span>
              </p>
              <div className={styles.actions}>
                <Link className={`veloxa-button-primary ${styles.roseButton}`} href="/register/">{copy.start}<ArrowRight size={18} aria-hidden="true" /></Link>
                <a className={styles.textLink} href="/#contoh">{copy.examplesLink}<ArrowDown size={16} aria-hidden="true" /></a>
              </div>
              <p className={styles.trialNote}><Check size={16} aria-hidden="true" />{copy.trial(new Intl.NumberFormat(locale).format(SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota))}</p>
            </div>
            <figure className={styles.heroVisual}>
              <div className={styles.visualOrbit} aria-hidden="true" />
              <div className={`${styles.campaignCard} ${styles.coffeeCard}`}>
                <Image src={images.coffee} alt="" fill sizes="250px" priority />
                <div className={styles.cardCopy}><span>Rona Coffee</span></div>
              </div>
              <div className={`${styles.campaignCard} ${styles.studioCard}`}>
                <Image src={images.studio} alt="" fill sizes="340px" priority />
                <div className={styles.cardCopy}><span>Ruang Studio</span><strong>{copy.campaigns[0][1]}</strong></div>
              </div>
              <figcaption className={styles.visualCaption}><Layers size={16} aria-hidden="true" />{copy.heroExample}</figcaption>
            </figure>
          </div>
        </section>

        <div className={styles.channels}>
          <div className={styles.container}>
            <span>{copy.channels}</span>
            <span><Instagram size={19} aria-hidden="true" /> Instagram</span>
            <span><Facebook size={18} aria-hidden="true" /> Facebook</span>
          </div>
        </div>

        <section id="cara-kerja" className={styles.workflowSection} aria-labelledby="veloxa-workflow-heading">
          <div className={`${styles.container} ${styles.section} ${styles.workflowGrid}`}>
            <div>
              <h2 id="veloxa-workflow-heading">{workflow.title.join(' ')}</h2>
              <p className={styles.lead}>{workflow.description}</p>
            </div>
            <VeloxaWorkflowDemo locale={locale} image={images.coffee} />
          </div>
        </section>

        <section id="fitur" className={`${styles.container} ${styles.section}`} aria-labelledby="veloxa-features">
          <h2 id="veloxa-features">{copy.features}</h2>
          <p className={styles.lead}>{copy.featureLead}</p>
          <div className={styles.features}>
            {copy.featureItems.map(([title, description], index) => {
              const Icon = featureIcons[index];
              return <article key={title}>
                <Icon size={25} strokeWidth={1.65} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>;
            })}
          </div>
        </section>

        <section id="contoh" className={styles.sampleSection} aria-labelledby="veloxa-samples">
          <div className={`${styles.container} ${styles.section} ${styles.sampleGrid}`}>
            <div>
              <h2 id="veloxa-samples">{copy.sampleTitle}</h2>
              <p className={styles.lead}>{copy.sampleLead}</p>
              <div role="group" aria-label={copy.sampleMode} className={styles.sampleChoices}>
                {copy.sampleNames.map((label, index) => (
                  <button key={label} type="button" aria-pressed={index === campaign} onClick={() => setCampaign(index)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.sampleBrief}>
                <p className={styles.briefLabel}>{copy.brief}</p>
                <p>{brief}</p>
                <p className={styles.briefLabel}><Layers size={16} aria-hidden="true" />{copy.draft}</p>
                <ol>{slides.map(slide => <li key={slide}>{slide}</li>)}</ol>
              </div>
            </div>
            <figure className={styles.sampleArtwork}>
              <div className={`${styles.campaignCard} ${styles.sampleCard}`}>
                <Image src={campaign === 0 ? images.studio : images.coffee} alt="" fill sizes="350px" />
                <div className={styles.cardCopy}><span>{name}</span><strong>{campaignTitle}</strong></div>
              </div>
              <figcaption>{copy.sampleLabel}</figcaption>
            </figure>
          </div>
        </section>

        <section className={`${styles.container} ${styles.section}`} aria-labelledby="veloxa-comparison">
          <h2 id="veloxa-comparison">{copy.comparison}</h2>
          <div className={styles.comparison}>
            <table role="table" aria-label={copy.comparisonLabel}>
              <thead role="rowgroup"><tr role="row">{copy.comparisonHead.map(label => <th key={label} scope="col" role="columnheader">{label}</th>)}</tr></thead>
              <tbody role="rowgroup">{copy.comparisonRows.map(([label, ...cells]) => <tr key={label} role="row">
                <th scope="row" role="rowheader">{label}</th>
                {cells.map(cell => <td key={cell} role="cell">{cell}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <p className={styles.help}>{copy.comparisonNote}</p>
        </section>

        <section id="hemat" className={styles.savingsSection} aria-labelledby="veloxa-savings">
          <div className={`${styles.container} ${styles.section}`}>
            <h2 id="veloxa-savings">{copy.calculator}</h2>
            <p className={styles.lead}>{copy.calculatorLead}</p>
            <CostCalculator key={localeInfo.currencyCode} locale={locale} currency={localeInfo.currencyCode} />
          </div>
        </section>

        <section id="harga" className={`${styles.container} ${styles.section}`} aria-labelledby="veloxa-pricing">
          <h2 id="veloxa-pricing">{copy.pricing}</h2>
          <div className={styles.pricingGrid}>
            {Object.values(SUBSCRIPTION_PLANS).map((plan, index) => {
              const trial = plan.id === 'free_trial';
              const price = getPlanLocalizedPrice(plan.id, locale);
              return <article key={plan.id} className={trial ? styles.trialPlan : undefined}>
                <h3>{copy.plans[index]}</h3>
                <p className={styles.planPrice}>{trial ? copy.free : <bdi>{price.amountFormatted}</bdi>}</p>
                <p className={styles.pricePeriod}>{price.periodLabel}</p>
                <p>{copy.planDescriptions[index]}</p>
                <p className={styles.planQuota}><Check size={17} aria-hidden="true" />{plan.monthlyPostQuota} {copy.publication} {trial ? copy.trialPeriod : copy.monthly}</p>
                {trial && <Link className={`veloxa-button-primary ${styles.roseButton}`} href="/register/">{copy.start}<ArrowRight size={17} aria-hidden="true" /></Link>}
              </article>;
            })}
          </div>
          <p className={styles.help}>{copy.paidAvailability}</p>
        </section>

        <section className={styles.closing} aria-labelledby="veloxa-closing">
          <div className={`${styles.container} ${styles.section}`}>
            <div><h2 id="veloxa-closing">{copy.closing}</h2><p className={styles.lead}>{copy.closingLead}</p></div>
            <Link className={`veloxa-button-primary ${styles.roseButton}`} href="/register/">{copy.start}<ArrowUpRight size={18} aria-hidden="true" /></Link>
          </div>
        </section>
        <footer className={styles.footer}>
          <div className={styles.container}>
            <span>© {new Date().getFullYear()} Veloxa AI</span>
            <div><Link href="/terms/">{copy.terms}</Link><Link href="/privacy/">{copy.privacy}</Link></div>
          </div>
        </footer>
      </div>
    </div>
  );
}
