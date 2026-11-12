'use client';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';

import { useEffect, useRef } from 'react';
import {ContentMediaGallery} from './ContentMediaGallery';
import type { ContentDraft } from '@/lib/veloxa-types';

interface PublishReviewDialogProps {
  draft: ContentDraft | null;
  brandName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PublishReviewDialog({ draft, brandName, onCancel, onConfirm }: PublishReviewDialogProps) {
 const {t}=useWorkspaceCopy(workspaceCatalog);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (draft && !dialog.open) {
      dialog.showModal();
      headingRef.current?.focus({preventScroll:true});
      dialog.scrollTop=0;
    }
    else if (!draft && dialog.open) dialog.close();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [draft]);

  if (!draft) return null;

  const previewImages = draft.format === 'carousel'
    ? (draft.renderedSlides?.length === 5 ? draft.renderedSlides : [])
    : (draft.renderedMedia ? [draft.renderedMedia] : []);
  const captionWithHashtags = [draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n');

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="publish-review-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      style={{width:'min(calc(100% - 2rem), 1080px)'}}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-[1080px] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/50"
    >
      <div className="space-y-5 p-5 sm:p-7">
        <header className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-wide text-[#a92e5d]">{t("Tinjauan publikasi")}</p>
          <h2 ref={headingRef} tabIndex={-1} id="publish-review-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">{t("Tinjau sebelum terbit")}</h2>
          <p className="text-base text-neutral-600">{draft.title} · {brandName}</p>
        </header>

        <section aria-label={t("Akun tujuan publikasi")} className="space-y-2">
          <h3 className="text-base font-medium text-neutral-900">{t("Akun tujuan")}</h3>
          {draft.publishTargets?.length ? (
            <ul className="space-y-2">
              {draft.publishTargets.map((target) => (
                <li key={`${target.channel}-${target.accountId}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-base">
                  <span className="font-semibold capitalize">{target.channel}</span>
                  <span className="min-w-0 break-words text-right text-neutral-600">{target.accountName} <span className="text-neutral-500">({target.handle})</span>{draft.channelStatuses.some(status=>status.status==='published'&&(status.connectionId?status.connectionId===target.connectionId:status.accountId?status.accountId===target.accountId&&status.channel===target.channel:status.channel===target.channel&&draft.publishTargets!.filter(item=>item.channel===target.channel).length===1))&&<span className="mt-1 block text-sm text-emerald-700">{t("Sudah terbit · tidak dikirim ulang")}</span>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-base text-neutral-600">{t("Akun tujuan belum tersedia.")}</p>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-medium text-neutral-900">{t("Visual final")}</h3>
            <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-700">{draft.format === 'short_video' ? `1 video · ${Math.round(draft.renderedVideo?.durationSeconds || 0)} detik` : draft.format === 'carousel' ? t("5 slide") : t("1 gambar")}</span>
          </div>
          {draft.format === 'short_video' && draft.renderedVideo ? (
            <div className="space-y-2">
              <video controls playsInline preload="metadata" poster={draft.renderedMedia?.url} src={draft.renderedVideo.url} aria-label={`Tinjau Reels ${draft.title}`} className="mx-auto aspect-[9/16] max-h-96 w-auto rounded-xl border border-neutral-200 bg-neutral-950" />
              <p className="text-center text-sm text-neutral-600">{draft.renderedVideo.voiceDisclosure} {t("Dengarkan narasinya sebelum menerbitkan.")}</p>
            </div>
          ) : previewImages.length && draft.format !== 'short_video' ? (
            <ContentMediaGallery key={draft.id} title={draft.title} images={previewImages.map((image,index)=>({url:image.url,alt:draft.format==='carousel'?`${draft.title} — Slide ${index+1}`:draft.title}))}/>
          ) : (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-base text-amber-900">{t("Visual final belum tersedia lengkap untuk ditinjau.")}</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-medium text-neutral-900">{t("Caption dan tagar")}</h3>
          <p className="whitespace-pre-wrap break-words rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-base leading-relaxed text-neutral-700">{captionWithHashtags}</p>
        </section>

        <p className="rounded-xl border border-pink-100 bg-pink-50/70 p-3 text-sm leading-relaxed text-neutral-700">{t("Satu publikasi ini menggunakan satu kuota post, termasuk untuk carousel lima slide atau satu Reels.")}</p>

        <footer className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base font-medium text-neutral-700 transition hover:border-neutral-400"
          >{t("Batal")} </button>
          <button
            type="button"
            disabled={!draft.publishTargets?.length || !draft.qualityReview.passed || (draft.format === 'short_video' ? !draft.renderedVideo : previewImages.length !== (draft.format === 'carousel' ? 5 : 1))}
            onClick={onConfirm}
            className="rounded-xl bg-[#D85A88] px-4 py-3 text-base font-medium text-white shadow-sm transition hover:bg-[#C44B78] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#D85A88]"
          >
            {draft.status==='publish_queued'?t("Lanjutkan publikasi"):t("Terbitkan sekarang")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
