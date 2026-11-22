'use client';
import { useEffect, useRef, useState } from 'react';
import type { YouTubeProduction } from '@/lib/youtube-production';

const pageSize = 6;
const button = 'veloxa-button-secondary min-h-11 text-sm disabled:opacity-50';
export function VeloxaYouTubeSceneGallery({ production, media }: { production: YouTubeProduction; media: (name: string) => string }) {
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [retries, setRetries] = useState<Record<number, number>>({});
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const attempts = useRef<Record<number, number>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const active = timers.current; return () => active.forEach(clearTimeout); }, []);
  function imageError(index: number) {
    const attempt = attempts.current[index] ?? 0;
    if (attempt >= 3) { setRetrying(value => ({ ...value, [index]: false })); setFailed(value => ({ ...value, [index]: true })); return; }
    attempts.current[index] = attempt + 1;
    setRetrying(value => ({ ...value, [index]: true }));
    const timer = setTimeout(() => { timers.current.delete(timer); setRetries(value => ({ ...value, [index]: (value[index] ?? 0) + 1 })); }, 500 * 2 ** attempt);
    timers.current.add(timer);
  }
  const scenes = production.blocks.flatMap(block => block.scenes);
  const completed = Math.min(scenes.length, production.progress?.images ?? (production.state === 'ready' ? scenes.length : 0));
  if (!completed) return null;
  const currentPage = Math.min(page, Math.ceil(completed / pageSize) - 1), start = currentPage * pageSize;
  return <section aria-label="Gambar adegan yang sudah dibuat" className="min-w-0 space-y-4 border-t pt-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-lg font-semibold">Gambar yang sudah dibuat</h3><p className="text-sm text-neutral-600">{completed} dari {scenes.length} gambar tersimpan</p></div>
    <p className="text-sm text-neutral-600">Gambar muncul setelah selesai dibuat. Narasi di bawahnya adalah ucapan yang dipakai untuk adegan tersebut.</p>
    {production.state === 'ready' && <a href="#youtube-final-preview" className="inline-flex min-h-11 items-center text-sm font-medium text-[#a92e5d] underline">Putar video akhir</a>}
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">{scenes.slice(start, Math.min(start + pageSize, completed)).map((scene, offset) => {
      const index = start + offset, url = media(`${index}-preview.jpg`) + (retries[index] ? `&previewRetry=${retries[index]}` : '');
      return <figure key={index} className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {failed[index] ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 bg-neutral-50 p-3 text-center text-sm"><p>Pratinjau belum termuat. Gambar tetap tersimpan.</p><button type="button" className={button} onClick={() => { attempts.current[index] = 0; setFailed(value => ({ ...value, [index]: false })); setRetrying(value => ({ ...value, [index]: true })); setRetries(value => ({ ...value, [index]: (value[index] ?? 0) + 1 })); }}>Muat ulang gambar {index + 1}</button></div>
          : <div className="relative bg-neutral-50"><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Buka gambar adegan ${index + 1} ukuran penuh`} className="block focus-visible:outline-2 focus-visible:outline-[#a92e5d]"><img src={url} loading="lazy" decoding="async" alt={`Ilustrasi adegan ${index + 1}: ${scene.title}`} onError={() => imageError(index)} onLoad={() => { attempts.current[index] = 0; setRetrying(value => ({ ...value, [index]: false })); }} className={`w-full object-contain ${retrying[index] ? 'opacity-0' : ''} ${production.settings.kind === 'short' ? 'aspect-[9/16]' : 'aspect-video'}`} /></a>{retrying[index] && <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm text-neutral-600">Memuat ulang pratinjau…</p>}</div>}
        <figcaption className="space-y-2 p-3"><p className="text-sm font-semibold">Adegan {index + 1} · {scene.title}</p><p className="break-words text-sm text-neutral-600">{scene.narration}</p></figcaption>
      </figure>;
    })}</div>
    {completed > pageSize && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral-600">Gambar {start + 1}–{Math.min(start + pageSize, completed)} dari {completed}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Gambar sebelumnya</button><button type="button" className={button} disabled={start + pageSize >= completed} onClick={() => setPage(currentPage + 1)}>Gambar berikutnya</button></div></div>}
  </section>;
}
