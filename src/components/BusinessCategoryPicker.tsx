'use client';

import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { BUSINESS_CATEGORIES, businessCategoryLabel } from '@/lib/business-categories';
import { categoryLabels, categoryPickerCopy } from '@/lib/business-category-labels';
import type { VeloxaLocale } from '@/lib/veloxa-i18n';
import type { BusinessCategory } from '@/lib/veloxa-types';

export function BusinessCategoryPicker({ value, onChange, locale = 'id' }: {
  value: BusinessCategory;
  onChange: (value: BusinessCategory) => void;
  locale?: VeloxaLocale;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const copy = categoryPickerCopy[locale];
  const labels = locale === 'id' ? null : categoryLabels[locale];
  const searchKey = (text: string) => text.toLocaleLowerCase(locale).normalize('NFD').replace(/\p{Mark}/gu, '');
  const needle = searchKey(query.trim());
  const options = BUSINESS_CATEGORIES
    .map(item => ({ ...item, localizedLabel: labels?.[item.value] ?? item.label }))
    .filter(item => searchKey(`${item.localizedLabel} ${item.label} ${item.keywords}`).includes(needle));

  return (
    <div lang={locale}>
      <label htmlFor={`${id}-trigger`} className="block text-sm font-medium">{copy.label}</label>
      <button id={`${id}-trigger`} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        onClick={() => {
          setQuery('');
          dialog.current?.showModal();
          setOpen(true);
          search.current?.focus();
        }}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3.5 py-3 text-start text-base text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#bd416e]">
        {labels?.[value] ?? businessCategoryLabel(value)}<ChevronDown size={18} aria-hidden="true" className="shrink-0 text-neutral-400" />
      </button>
      <p className="mt-2 text-sm text-neutral-500">{copy.hint}</p>
      <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} onClose={() => setOpen(false)}
        className="m-auto max-h-[90dvh] w-[min(640px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-xl backdrop:bg-black/40 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${id}-title`} className="text-xl font-semibold">{copy.title}</h3>
          <button type="button" aria-label={copy.close} onClick={() => dialog.current?.close()}
            className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-neutral-100">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <label className="relative mt-5 block">
          <span className="sr-only">{copy.search}</span>
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 text-neutral-400" />
          <input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') event.preventDefault();
              if (event.key === 'Escape') {
                event.preventDefault();
                dialog.current?.close();
              }
            }}
            placeholder={copy.placeholder}
            className="w-full rounded-lg border border-neutral-300 py-3 pe-3 ps-10 text-base focus:border-[#bd416e] focus:outline-none focus:ring-2 focus:ring-[#bd416e]/10" />
        </label>
        <p role="status" className="mt-3 text-sm text-neutral-500">
          {options.length ? copy.results(options.length, new Intl.NumberFormat(locale).format(options.length)) : copy.empty}
        </p>
        <div className="mt-3 grid max-h-[48dvh] gap-2 overflow-y-auto sm:grid-cols-2">
          {options.map(item => (
            <button key={item.value} type="button" aria-pressed={value === item.value}
              onClick={() => {
                onChange(item.value);
                dialog.current?.close();
              }}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border p-3 text-start text-base ${value === item.value ? 'border-[#bd416e] bg-[#faf0f4] text-[#a92e5d]' : 'border-neutral-200 hover:bg-neutral-50'}`}>
              {item.localizedLabel}{value === item.value && <Check size={18} aria-hidden="true" className="shrink-0" />}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
