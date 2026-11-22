'use client';

import { Layers, Youtube } from 'lucide-react';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';

type Mode = 'social' | 'youtube';

const modes = [
  { id: 'social', title: 'Facebook & Instagram', description: 'Buat draf dan kelola koleksi konten.', icon: Layers },
  { id: 'youtube', title: 'YouTube Studio', description: 'Produksi video dan Shorts dengan AI.', icon: Youtube },
] as const;

export function VeloxaStudioModePicker({ value, onChange, busy }: { value: Mode; onChange: (mode: Mode) => void; busy: boolean }) {
  const { t } = useWorkspaceCopy(workspaceCatalog);
  return <div role="group" aria-label={t('Pilih studio konten')} className="grid min-w-0 gap-3 sm:grid-cols-2">
    {modes.map(({ id, title, description, icon: Icon }) => <button
      type="button" key={id} aria-pressed={id === value} disabled={busy && id !== value} onClick={() => onChange(id)}
      className={`flex min-h-11 min-w-0 items-start gap-3 rounded-xl border p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a92e5d] disabled:opacity-50 ${id === value ? 'border-[#bd416e] bg-[#faf2f5] text-[#682943]' : 'border-neutral-200 bg-white text-neutral-900 hover:border-[#ad6685]'}`}
    >
      <span className="shrink-0 rounded-lg bg-white p-2 text-[#a92e5d]"><Icon size={21} aria-hidden="true" strokeWidth={1.7} /></span>
      <span className="min-w-0">
        <span className="block break-words text-base font-semibold">{t(title)}</span>
        <span className="mt-1 block break-words text-sm text-neutral-600">{t(description)}</span>
      </span>
    </button>)}
  </div>;
}
