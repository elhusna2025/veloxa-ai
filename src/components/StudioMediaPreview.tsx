'use client';

import {ContentMediaGallery} from './ContentMediaGallery';
import type { ContentDraft } from '@/lib/veloxa-types';

interface StudioMediaPreviewProps {
  draft: ContentDraft;
  fallbackUrl: string;
}

export default function StudioMediaPreview({ draft, fallbackUrl }: StudioMediaPreviewProps) {

  if (draft.format === 'short_video') {
    return draft.renderedVideo ? (
      <div className="space-y-3">
        <video controls playsInline preload="metadata" poster={draft.renderedMedia?.url} src={draft.renderedVideo.url} aria-label={`Pratinjau Reels ${draft.title}`} data-testid={`rendered-reel-${draft.id}`} className="mx-auto aspect-[9/16] max-h-96 w-auto rounded-xl border border-neutral-200 bg-neutral-950" />
        <p className="text-center text-sm font-semibold text-neutral-600">{Math.round(draft.renderedVideo.durationSeconds)} detik · 9:16 · Suara AI</p>
        <p className="text-center text-sm text-neutral-500">Putar video untuk meninjau gambar, intonasi, dan jeda narasi sebelum terbit.</p>
      </div>
    ) : <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-900">Video Reels final belum tersedia. Buat ulang draf sebelum menerbitkan.</p>;
  }

  if (draft.format !== 'carousel') {
    const imageUrl = draft.renderedMedia?.url || fallbackUrl;
    return <ContentMediaGallery key={draft.id} title={draft.title} testId={`rendered-poster-img-${draft.id}`} images={[{url:imageUrl,alt:draft.title}]}/>;
  }

  const slides = draft.renderedSlides || [];
  if (slides.length !== 5) {
    return (
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-900">
        Pratinjau carousel belum tersedia lengkap. Lima gambar final diperlukan sebelum carousel dapat ditinjau.
      </p>
    );
  }

  return <ContentMediaGallery key={draft.id} title={draft.title} testId={`rendered-poster-img-${draft.id}`} images={slides.map((slide,index)=>({url:slide.url,alt:`${draft.title} — Slide ${index+1}`}))}/>;
}
