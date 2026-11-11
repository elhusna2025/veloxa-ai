'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { PRIMARY_BUSINESS } from '@/lib/business-context';
import {
  carouselSlideLimits, validateCarouselPlan, type CarouselPlan, type CarouselPlanProposal,
} from '@/lib/carousel-plan';
import { profileFingerprint } from '@/lib/profile-fingerprint';
import { BLEND_STAGES, type BlendStage } from '@/lib/reference-blend';
import { requestCarouselPlan } from '@/lib/veloxa-api-client';
import type { BrandProfile, BrandVaultAsset } from '@/lib/veloxa-types';
import type { ContentReferenceRoles } from '@/lib/content-reference-roles';
import type { ContentIntent, ContentSourceMode } from '@/lib/content-source';

interface Props {
  brand: BrandProfile;
  topic: string;
  instruction: string;
  assetIds: string[];
  roles: ContentReferenceRoles;
  assets: BrandVaultAsset[];
  sourceMode: ContentSourceMode;
  offeringIds: string[];
  intent: ContentIntent;
  contextKey: string;
  plan?: CarouselPlan;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onReviewChange: (pending: boolean) => void;
  onApply: (proposal: CarouselPlanProposal) => void;
  onEdit: (plan?: CarouselPlan) => void;
}

const inputClass = 'mt-1.5 block min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-base leading-relaxed';

export function CarouselPlanAssistant(props: Props) {
  const [stage, setStage] = useState<BlendStage | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ proposal: CarouselPlanProposal; key: string } | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const appliedNotice = useRef<HTMLParagraphElement>(null);
  const request = useRef<symbol | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const key = JSON.stringify([props.contextKey, props.topic, props.instruction]);
  const latest = useRef(key);
  latest.current = key;
  const proposal = result?.key === key ? result.proposal : null;
  const previewing = !!proposal;
  const slides = proposal?.slides ?? props.plan;
  const references = props.assetIds.map((id, index) => ({
    id, number: index + 1, title: props.assets.find(asset => asset.id === id)?.title ?? 'Gambar',
    role: props.roles[id],
  }));
  const visualRefs = references.filter(ref => ref.role === 'visual');
  const sharedRefs = references.filter(ref => ref.role && ref.role !== 'visual');

  useEffect(() => {
    callbacks.current.onReviewChange(previewing);
    if (previewing) reviewHeading.current?.focus();
    else if (props.plan) appliedNotice.current?.focus();
  }, [previewing]);

  useEffect(() => () => {
    if (request.current) callbacks.current.onBusyChange(false);
    callbacks.current.onReviewChange(false);
    request.current = null;
  }, []);

  async function suggest() {
    if (request.current || props.disabled) return;
    const run = Symbol();
    request.current = run;
    setError('');
    setResult(null);
    setStage('validation');
    props.onBusyChange(true);
    const businessId = props.brand.businessId || PRIMARY_BUSINESS;
    try {
      const fingerprint = await profileFingerprint(props.brand);
      if (request.current !== run) return;
      if (latest.current !== key) throw Error('Pilihan berubah. Susun rencana lagi dengan isian terbaru.');
      const data = await requestCarouselPlan({
        workspaceId: props.brand.workspaceId,
        businessId,
        expectedProfileFingerprint: fingerprint,
        referenceAssetIds: props.assetIds,
        referenceRoles: Object.fromEntries(props.assetIds.map(id => [id, props.roles[id]])),
        format: 'carousel',
        topic: props.topic,
        existingInstruction: props.instruction,
        sourceMode: props.sourceMode,
        offeringIds: props.sourceMode === 'offerings' ? props.offeringIds : [],
        contentIntent: props.intent,
      }, next => { if (request.current === run) setStage(next); });
      if (request.current !== run) return;
      if (latest.current !== key) throw Error('Pilihan berubah. Susun rencana lagi dengan isian terbaru.');
      if (data.workspaceId !== props.brand.workspaceId || data.businessId !== businessId || data.baseFingerprint !== fingerprint) {
        throw Error('Profil bisnis berubah. Muat ulang dan susun rencana kembali.');
      }
      validateCarouselPlan(data.slides, props.assetIds, props.roles);
      setResult({ proposal: data, key });
    } catch (error) {
      if (request.current === run) setError(error instanceof Error ? error.message : 'Rencana belum bisa dibuat. Silakan coba lagi.');
    } finally {
      if (request.current === run) {
        request.current = null;
        setStage(null);
        props.onBusyChange(false);
      }
    }
  }

  function editSlide(index: number, change: Partial<CarouselPlan[number]>) {
    props.onEdit(props.plan?.map((slide, position) => position === index ? { ...slide, ...change } : slide));
  }

  return <section className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:p-5" aria-label="Rencana carousel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">Rencana carousel</h3>
        <p className="mt-1 text-sm text-neutral-600">AI merangkai profil bisnis, topik, dan referensi menjadi lima slide.</p>
      </div>
      <button type="button" className="veloxa-button-secondary" disabled={props.disabled || !!stage}
        aria-busy={!!stage} onClick={() => void suggest()}>
        {stage ? <Loader2 size={17} aria-hidden="true" className="animate-spin motion-reduce:animate-none"/> : <Sparkles size={17} aria-hidden="true"/>}
        Susun rencana dengan AI
      </button>
    </div>
    {stage && <p role="status" className="mt-3 text-sm text-neutral-700">{stage === 'analysis' ? 'Menyusun topik dan isi slide' : BLEND_STAGES[stage]}…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {slides && <div className="mt-5 space-y-4">
      {proposal ? <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h4 ref={reviewHeading} tabIndex={-1} className="font-semibold">Usulan AI · {proposal.topic}</h4>
        <p className="mt-1 text-sm leading-relaxed text-neutral-600">{proposal.visualDirection}</p>
      </div> : <p ref={appliedNotice} tabIndex={-1} role="status" className="text-sm text-emerald-800">Rencana diterapkan. Buka slide untuk mengedit isi atau mengganti acuan.</p>}
      {!!sharedRefs.length && <p className="text-sm text-neutral-600">Aset asli di semua slide · {sharedRefs.map(ref => `Ref ${ref.number} · ${ref.title}`).join(', ')}</p>}
      <ol className="grid gap-3 xl:grid-cols-2">
        {slides.map((slide, index) => {
          const assigned = visualRefs.filter(ref => slide.assetIds.includes(ref.id));
          const referenceLabels = assigned.map(ref => `Ref ${ref.number} · ${ref.title}`).join(', ');
          return <li key={index} className="min-w-0 rounded-lg border border-neutral-200 bg-white">
            {previewing ? <div className="space-y-2 p-4">
              <p className="text-sm font-semibold text-[#a92e5d]">Slide {index + 1}</p>
              <h5 className="break-words text-base font-semibold">{slide.headline}</h5>
              <p className="break-words text-base">{slide.body}</p>
              <p className="break-words text-sm leading-relaxed text-neutral-600">{slide.visualDirection}</p>
              {referenceLabels && <p className="break-words text-sm font-medium text-[#a92e5d]">{referenceLabels}</p>}
            </div> : <details>
              <summary className="min-h-11 cursor-pointer break-words p-4 text-sm">
                <span className="ml-1 font-semibold text-[#a92e5d]">Slide {index + 1}</span>
                <span className="ml-2 text-base font-medium">{slide.headline || 'Judul belum diisi'}</span>
                {referenceLabels && <span className="ml-4 mt-1 block text-neutral-600">{referenceLabels}</span>}
              </summary>
              <fieldset aria-label={`Edit slide ${index + 1}`} disabled={props.disabled || !!stage}
                className="min-w-0 space-y-3 border-t border-neutral-100 p-4">
                <label className="block text-sm font-medium">Judul<input className={inputClass} maxLength={carouselSlideLimits.headline}
                  value={slide.headline} onChange={event => editSlide(index, { headline: event.target.value })}/></label>
                <label className="block text-sm font-medium">Isi<textarea className={inputClass} rows={2} maxLength={carouselSlideLimits.body}
                  value={slide.body} onChange={event => editSlide(index, { body: event.target.value })}/></label>
                <label className="block text-sm font-medium">Arahan adegan<textarea className={inputClass} rows={2} maxLength={carouselSlideLimits.visualDirection}
                  value={slide.visualDirection} onChange={event => editSlide(index, { visualDirection: event.target.value })}/></label>
                {!!visualRefs.length && <fieldset className="min-w-0">
                  <legend className="text-sm font-medium">Acuan visual slide ini</legend>
                  {visualRefs.map(ref => <label key={ref.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#a92e5d]" checked={slide.assetIds.includes(ref.id)}
                      onChange={event => editSlide(index, { assetIds: event.target.checked ? [...slide.assetIds, ref.id] : slide.assetIds.filter(id => id !== ref.id) })}/>
                    <span className="min-w-0 break-words">Ref {ref.number} · {ref.title}</span>
                  </label>)}
                </fieldset>}
              </fieldset>
            </details>}
          </li>;
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        {proposal ? <>
          <button type="button" className="veloxa-button-primary" disabled={props.disabled} onClick={() => {
            props.onApply(proposal);
            setResult(null);
          }}>Gunakan rencana ini</button>
          <button type="button" className="veloxa-button-secondary" onClick={() => setResult(null)}>Tutup usulan</button>
        </> : <button type="button" className="veloxa-button-secondary" disabled={props.disabled || !!stage} onClick={() => props.onEdit()}>
          Lepas rencana slide
        </button>}
      </div>
    </div>}
  </section>;
}
