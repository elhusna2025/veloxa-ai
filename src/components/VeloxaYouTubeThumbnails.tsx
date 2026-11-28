'use client';
import { useState } from 'react';
import type { YouTubeProduction } from '@/lib/youtube-production';

export type ThumbnailAction = { action: 'select_thumbnail'; id: string } |
  { action: 'thumbnail'; slot: number; expected: string | null; note: string };

type Props = {
  production: YouTubeProduction;
  media: (name: string) => string;
  busy: boolean;
  status: string;
  submit: (actions: ThumbnailAction[]) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
};

export function VeloxaYouTubeThumbnails({ production, media, busy, status, submit, onDirty }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [small, setSmall] = useState(false);
  const options = production.thumbnails?.options ?? [null, null];
  const selected = production.thumbnails?.selected;
  const submitted = Boolean(production.thumbnailSubmitted);
  const title = production.outline?.title ?? production.settings.topic;
  const url = (id: string) => media('thumb-' + id + '.jpg');
  const button = 'veloxa-button-secondary min-h-11 disabled:opacity-50';
  function closeEditor() { setEditing(null); setNote(''); onDirty(false); }
  return <section className="veloxa-panel min-w-0 space-y-4 p-4 sm:p-6">
    <h3 className="text-lg font-semibold">Thumbnail YouTube</h3>
    {options.some(Boolean) && <button type="button" className={button} aria-pressed={small} onClick={() => setSmall(!small)}>Pratinjau ukuran ponsel</button>}
    <div className="grid gap-4 sm:grid-cols-2">{options.map((id, slot) => {
      if (!id) return null;
      const label = slot === 0 ? 'A' : 'B';
      return <article key={slot} className="min-w-0 space-y-3 rounded-lg border p-3">
        <h4 className="font-semibold">Usulan {label}{id === selected && ' · Terpilih'}</h4>
        <div className="w-full" style={small ? { maxWidth: 160 } : undefined}><img src={url(id)} alt={'Thumbnail usulan ' + label} className="aspect-video w-full rounded-lg object-cover" /><p className="mt-1 break-words text-sm font-medium">{title}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={submitted || busy || id === selected || editing !== null} onClick={() => void submit([{ action: 'select_thumbnail', id }])}>Pilih {label}</button>
        <button type="button" className={button} disabled={submitted || busy || editing !== null} onClick={() => setEditing(slot)}>Revisi {label}</button>
        <a className={button} href={url(id) + '&download=1'}>Unduh {label}</a></div>
        {editing === slot && <div className="space-y-2"><label className="block">Catatan revisi {label}<textarea autoFocus maxLength={1000} value={note} onChange={e => { setNote(e.target.value); onDirty(Boolean(e.target.value)); }} className="mt-1 block w-full rounded-lg border p-2" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="veloxa-button-primary min-h-11" disabled={submitted || busy || !note.trim()} onClick={async () => { if (await submit([{ action: 'thumbnail', slot, expected: id, note }])) closeEditor(); }}>Buat revisi dengan AI</button>
          <button type="button" className={button} disabled={busy} onClick={closeEditor}>Batal</button></div></div>}
      </article>;
    })}</div>
    {options.some(id => !id) && <button type="button" className={button} disabled={submitted || busy || editing !== null} onClick={() => void submit(options.flatMap((id, slot) => id ? [] : [{ action: 'thumbnail' as const, slot, expected: null, note: '' }]))}>{options.some(Boolean) ? 'Lengkapi usulan thumbnail' : 'Buat dua usulan thumbnail'}</button>}
    {selected && !options.includes(selected) && <div className="space-y-1"><p className="font-medium">Thumbnail tersimpan untuk publikasi</p><img className="w-40 rounded-lg" src={url(selected)} alt="Pilihan tersimpan sebelum revisi" /></div>}
    <p className="text-sm text-neutral-600" role="status">{status || (submitted ? 'Video sudah masuk antrean pengiriman.' : selected ? 'Pilihan tersimpan untuk pengiriman video.' : 'Pilih thumbnail yang akan disertakan saat mengirim video.')}</p>
  </section>;
}
