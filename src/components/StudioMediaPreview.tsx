'use client';

import { useState } from 'react';
import type { ContentDraft } from '@/lib/veloxa-types';

interface StudioMediaPreviewProps {
  draft: ContentDraft;
  fallbackUrl: string;
}

export default function StudioMediaPreview({ draft, fallbackUrl }: StudioMediaPreviewProps) {
  const [selectedSlide, setSelectedSlide] = useState(0);

  if (draft.format !== 'carousel') {
    const imageUrl = draft.renderedMedia?.url || fallbackUrl;
    return (
      <div className="space-y-3">
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener"
          download={`${draft.id}.jpg`}
          aria-label={`Buka atau unduh visual ${draft.title}`}
          className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D85A88]"
        >
          <img
            data-testid={`rendered-poster-img-${draft.id}`}
            src={imageUrl}
            alt={draft.title}
            className="mx-auto max-h-80 w-auto rounded-xl border border-neutral-200 object-contain"
          />
        </a>
        <p className="text-center text-xs font-semibold text-neutral-500">Buka atau unduh visual final</p>
      </div>
    );
  }

  const slides = draft.renderedSlides || [];
  if (slides.length !== 5) {
    return (
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Pratinjau carousel belum tersedia lengkap. Lima gambar final diperlukan sebelum carousel dapat ditinjau.
      </p>
    );
  }

  const currentSlide = slides[selectedSlide];
  const selectSlide = (index: number) => setSelectedSlide(Math.min(Math.max(index, 0), slides.length - 1));

  return (
    <div className="space-y-3">
      <a
        href={currentSlide.url}
        target="_blank"
        rel="noopener"
        download={`${draft.id}-slide-${selectedSlide + 1}.jpg`}
        aria-label={`Buka atau unduh slide ${selectedSlide + 1} dari ${draft.title}`}
        className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D85A88]"
      >
        <img
          data-testid={`rendered-poster-img-${draft.id}`}
          src={currentSlide.url}
          alt={`${draft.title} — Slide ${selectedSlide + 1}`}
          className="mx-auto max-h-80 w-auto rounded-xl border border-neutral-200 object-contain"
        />
      </a>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => selectSlide(selectedSlide - 1)}
          disabled={selectedSlide === 0}
          className="rounded-xl border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-[#D85A88] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sebelumnya
        </button>
        <span aria-live="polite" className="text-xs font-bold text-neutral-600">Slide {selectedSlide + 1}/5</span>
        <button
          type="button"
          onClick={() => selectSlide(selectedSlide + 1)}
          disabled={selectedSlide === 4}
          className="rounded-xl border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-[#D85A88] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Berikutnya
        </button>
      </div>
      <div className="grid grid-cols-5 gap-2" aria-label="Pilih slide carousel">
        {slides.map((slide, index) => (
          <button
            key={`${draft.id}-slide-${index + 1}`}
            type="button"
            onClick={() => selectSlide(index)}
            aria-label={`Pilih slide ${index + 1}`}
            aria-pressed={selectedSlide === index}
            className={`overflow-hidden rounded-lg border-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D85A88] ${selectedSlide === index ? 'border-[#D85A88]' : 'border-neutral-200 hover:border-neutral-400'}`}
          >
            <img src={slide.url} alt="" className="aspect-[4/5] w-full object-cover" />
          </button>
        ))}
      </div>
      <p className="text-center text-xs font-semibold text-neutral-500">Buka atau unduh slide final yang dipilih</p>
    </div>
  );
}
