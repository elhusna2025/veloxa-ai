'use client';
import { Check, Circle, LoaderCircle, RotateCw } from 'lucide-react';
import { productionProgress, type YouTubeProduction } from '@/lib/youtube-production';

function wib(value: number) { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }).format(value) + ' WIB'; }
export function VeloxaYouTubeProgress({ production }: { production: YouTubeProduction }) {
  const model = productionProgress(production), p = production.progress;
  const waiting = Boolean(production.retryAt && production.retryAt > (p?.checkedAt ?? Date.now()) && !p?.working);
  const review = ['script_review', 'character_review'].includes(production.state);
  const paused = ['attention', 'cancelled'].includes(production.state);
  const running = !paused && !review && production.state !== 'ready';
  const title = paused ? production.state === 'attention' ? 'Produksi tertahan' : 'Produksi dihentikan'
    : review ? 'Siap ditinjau' : production.state === 'ready' ? 'Video siap diputar' : waiting ? 'Menunggu percobaan ulang otomatis' : model.detail;
  return <section aria-label="Progres produksi video" className="min-w-0 space-y-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
    <div className="flex min-w-0 items-start gap-3">
      {production.state === 'ready' ? <Check aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" size={21} /> : waiting ? <RotateCw aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" size={21} /> : running ? <LoaderCircle aria-hidden="true" className="mt-0.5 shrink-0 text-[#a92e5d] motion-safe:animate-spin" size={21} /> : <Circle aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500" size={21} />}
      <div className="min-w-0"><p role="status" className="break-words text-base font-semibold text-neutral-900">{title}</p>{(waiting || paused || review) && <p className="mt-1 text-sm text-neutral-600">{model.detail}</p>}</div>
    </div>
    <div className="space-y-2"><div className="flex flex-wrap justify-between gap-2 text-sm text-neutral-600"><span>Bagian produksi yang selesai</span><span className="font-medium tabular-nums text-neutral-800">{model.done} dari {model.total}</span></div><progress aria-label="Bagian produksi yang selesai" aria-valuetext={`${model.done} dari ${model.total} bagian selesai. ${model.detail}`} max={model.total} value={model.done} className="block h-2.5 w-full accent-[#a92e5d]" /></div>
    <ol className={`grid min-w-0 gap-3 sm:grid-cols-2 ${model.steps.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>{model.steps.map(step => <li key={step.id} aria-current={step.status === 'current' ? 'step' : undefined} className={`min-w-0 rounded-lg border p-3 ${step.status === 'current' ? 'border-[#bd416e] bg-[#faf2f5]' : 'border-neutral-200 bg-white'}`}><div className="flex items-start gap-2">{step.status === 'complete' ? <Check size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" /> : <Circle size={15} aria-hidden="true" className={`mt-1 shrink-0 ${step.status === 'current' ? 'text-[#a92e5d]' : 'text-neutral-400'}`} />}<span className="min-w-0 break-words text-sm font-medium">{step.label}</span></div><p className="mt-2 text-sm text-neutral-600">{step.status === 'complete' ? 'Selesai' : step.status === 'waiting' ? 'Menunggu tahap sebelumnya' : paused ? 'Tertahan di tahap ini' : waiting ? 'Akan dicoba ulang' : review ? 'Menunggu tinjauan' : 'Sedang dikerjakan'}</p><p className="mt-1 text-sm tabular-nums text-neutral-500">{step.total ? `${step.done} / ${step.total} bagian` : 'Jumlah mengikuti naskah'}</p></li>)}</ol>
    {production.state === 'attention' && production.message && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{production.message}</p>}
    {(waiting || Boolean(p?.attempts)) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{p?.working ? 'Percobaan ulang sedang berjalan pada tahap ini.' : waiting ? `Tahap yang tersendat akan dicoba kembali otomatis pada ${wib(production.retryAt!)}.` : production.state === 'attention' ? 'Percobaan otomatis belum menyelesaikan tahap ini. Hasil sebelumnya tetap tersimpan.' : 'Proses sedang melanjutkan bagian yang belum selesai.'}</p>{Boolean(p?.attempts) && <p className="mt-1">{p!.attempts} percobaan sebelumnya belum berhasil. Bagian yang selesai tidak dibuat ulang.</p>}</div>}
    <p className="text-sm text-neutral-500">{p?.checkedAt ? `Status diperiksa ${wib(p.checkedAt)}. ` : ''}{running ? 'Anda boleh meninggalkan Studio; proses tersimpan dan dilanjutkan di latar belakang.' : production.state === 'ready' ? 'Tonton video akhir sebelum menerbitkan.' : 'Hasil yang sudah selesai tetap tersimpan.'}</p>
  </section>;
}
