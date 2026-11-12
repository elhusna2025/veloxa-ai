'use client';

import React from 'react';
import { ArrowRight, Check, Link2, Send } from 'lucide-react';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import type { firstPostProgress } from '@/lib/first-post-guide';
import { workspaceCatalog } from '@/lib/workspace-catalog';

const steps = [
  { id: 'account', title: 'Hubungkan akun sosial', description: 'Beri izin untuk Instagram profesional atau Halaman Facebook. Saat kembali ke Veloxa, tambahkan akun yang dipilih, lalu tautkan lewat Kelola bisnis.' },
  { id: 'profile', title: 'Lengkapi Profil & aset', description: 'Jelaskan apa yang Anda tawarkan, siapa pelanggan Anda, dan gaya bahasanya. Tambahkan logo atau foto produk jika ada, lalu simpan. Veloxa memakai profil ini untuk membuat caption dan visual yang sesuai dengan bisnis Anda.' },
  { id: 'draft', title: 'Buat draf di Content Studio', description: 'Mulai dengan Post tunggal. Pilih akun tujuan dan tulis topik atau pilih produk dari profil, lalu tekan Buat draf.' },
  { id: 'publish', title: 'Tinjau dan terbitkan', description: 'Periksa gambar, caption, dan akun tujuan. Pilih Tinjau & terbitkan, lalu Terbitkan sekarang. Setelah berhasil, cek status Sudah tayang di Studio.' },
] as const;

interface Props {
  progress: ReturnType<typeof firstPostProgress>;
  canAssignAccount: boolean;
  hasDrafts: boolean;
  disabled: boolean;
  onConnect: () => void;
  onAssign: () => void;
  onProfile: () => void;
  onDraft: () => void;
  onCollection: () => void;
  onReview: (draftId: string) => void;
}

export function VeloxaFirstPostGuide({ progress, canAssignAccount, hasDrafts, disabled, onConnect, onAssign, onProfile, onDraft, onCollection, onReview }: Props) {
  const { t, locale } = useWorkspaceCopy(workspaceCatalog);
  const number = new Intl.NumberFormat(locale);
  const done = {
    account: progress.hasAccount,
    profile: progress.hasProfile,
    draft: Boolean(progress.reviewDraft),
    publish: false,
  };
  const accountAction = canAssignAccount
    ? { label: 'Tautkan akun ke bisnis', run: onAssign }
    : { label: 'Hubungkan akun sosial', run: onConnect };
  const actions = {
    account: accountAction,
    profile: { label: 'Buka Profil & aset', run: onProfile },
    draft: hasDrafts ? { label: 'Buka koleksi draf', run: onCollection } : { label: 'Buat draf pertama', run: onDraft },
    publish: { label: 'Tinjau draf', run: () => { if (progress.reviewDraft) onReview(progress.reviewDraft.id); } },
  };
  const action = actions[progress.current];

  return (
    <section className="ws-first-post" aria-labelledby="first-post-heading">
      <div className="ws-first-post-intro">
        <span className="ws-first-post-icon" aria-hidden="true">{progress.current === 'account' ? <Link2 size={21}/> : <Send size={21}/>}</span>
        <div>
          <h2 id="first-post-heading">{t(progress.hasPublished ? 'Hubungkan akun sosial' : 'Postingan pertama Anda')}</h2>
          <p>{t(progress.current === 'account'
            ? canAssignAccount ? 'Akun sudah terhubung ke Veloxa. Tautkan akun itu ke bisnis aktif untuk mulai membuat dan menerbitkan konten.'
              : 'Bisnis ini belum punya akun sosial yang siap digunakan. Hubungkan satu akun untuk mulai membuat konten.'
            : 'Ikuti langkah yang ditandai untuk menyiapkan dan menerbitkan postingan pertama Anda.')}</p>
        </div>
        <button type="button" disabled={disabled} className="veloxa-button-primary ws-first-post-action" onClick={action.run}>
          {t(action.label)}<ArrowRight size={16} aria-hidden="true" className="ws-overview-arrow"/>
        </button>
      </div>

      {!progress.hasPublished && (
        <ol className="ws-first-post-steps" aria-label={t('Langkah publikasi pertama')}>
          {steps.map((step, index) => {
            const current = progress.current === step.id;
            return (
              <li key={step.id} aria-current={current ? 'step' : undefined} data-done={done[step.id] || undefined}>
                <span className="ws-first-post-step-mark" aria-hidden="true">{done[step.id] ? <Check size={15}/> : number.format(index + 1)}</span>
                <div>
                  <h3>{t(step.title)}{done[step.id] && <span className="sr-only"> · {t('Selesai')}</span>}</h3>
                  <p>{t(step.description)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
