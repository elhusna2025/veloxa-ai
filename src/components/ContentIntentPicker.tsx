'use client';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import {useId} from 'react';
import {CONTENT_INTENTS,type ContentIntent} from '@/lib/content-source';

interface Props {
  value: ContentIntent;
  onChange: (value: ContentIntent) => void;
  disabled?: boolean;
  label: string;
}

const descriptions: Record<ContentIntent,string> = {
  auto: 'AI memilih sudut bahasan yang paling sesuai.',
  education: 'Jelaskan manfaat dan wawasan secara informatif.',
  introduction: 'Perkenalkan produk atau layanan dengan jelas.',
  promotion: 'Ajak audiens mengenal atau memakai penawaran.',
};

export function ContentIntentPicker({value,onChange,disabled=false,label}:Props) {
  const id=useId();
  const {t}=useWorkspaceCopy(workspaceCatalog);
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="text-sm font-medium">{label}</legend>
    <div role="radiogroup" aria-label={label} className="mt-2 grid gap-2 sm:grid-cols-2">
      {(Object.entries(CONTENT_INTENTS) as [ContentIntent,string][]).map(([intent,title])=><label key={intent} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${value===intent?'border-[#ad6685] bg-[var(--ws-soft,#faeff4)]':'border-neutral-200 bg-white hover:border-neutral-300'} ${disabled?'cursor-not-allowed opacity-60':''}`}>
        <input type="radio" name={`content-intent-${id}`} value={intent} checked={value===intent} onChange={()=>onChange(intent)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--ws-action,#682943)]"/>
        <span className="min-w-0"><span className="block break-words text-base font-medium text-neutral-900">{t(title)}</span><span className="mt-1 block text-sm leading-relaxed text-neutral-500">{t(descriptions[intent])}</span></span>
      </label>)}
    </div>
  </fieldset>;
}
