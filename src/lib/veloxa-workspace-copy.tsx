'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { VELOXA_LOCALES, type VeloxaLocale } from './veloxa-i18n';

type Translations = readonly [string, string, string, string, string];
const languageIndex = { en: 0, es: 1, ar: 2, ja: 3, ko: 4 } as const;
export type WorkspaceCatalog = Record<string, Translations>;
const Locale = createContext<VeloxaLocale>('id');

export function WorkspaceLanguage({ locale, children }: { locale: VeloxaLocale; children: ReactNode }) {
  return <Locale.Provider value={locale}>{children}</Locale.Provider>;
}

export function workspaceTranslator(locale: VeloxaLocale, catalog: WorkspaceCatalog) {
  return (message: string, values?: Record<string, string | number>) => {
    const label = locale === 'id' ? message : catalog[message]?.[languageIndex[locale]] ?? message;
    return values ? label.replace(/\{(\w+)\}/g, (placeholder, key) => String(values[key] ?? placeholder)) : label;
  };
}

export function useWorkspaceCopy(catalog: WorkspaceCatalog) {
  const locale = useContext(Locale);
  const language = VELOXA_LOCALES.find(item => item.code === locale)!;
  return { locale, dir: language.dir, t: workspaceTranslator(locale, catalog) };
}
