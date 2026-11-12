import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './VeloxaDedicatedPageShell.module.css';

type LegalSection = {
  id: string;
  title: string;
  body: string;
  bullets: string[];
};

export const legalContactEmail = 'legal@veloxa.ai';

export function VeloxaLegalDocument({ page, isId, sections, children }: {
  page: 'terms' | 'privacy';
  isId: boolean;
  sections: LegalSection[];
  children: ReactNode;
}) {
  return (
    <>
      <p className="mt-4 text-sm text-neutral-600">
        {page === 'terms' ? (isId ? 'Berlaku sejak ' : 'Effective from ') : (isId ? 'Terakhir diperbarui ' : 'Last updated ')}
        <time dateTime="2026-11-03">{isId ? '3 November 2026' : 'November 3, 2026'}</time>
      </p>
      <nav className={styles.documentNav} aria-label={isId ? 'Dokumen hukum' : 'Legal documents'}>
        <Link href="/terms/" aria-current={page === 'terms' ? 'page' : undefined}>{isId ? 'Ketentuan' : 'Terms'}</Link>
        <Link href="/privacy/" aria-current={page === 'privacy' ? 'page' : undefined}>{isId ? 'Privasi' : 'Privacy'}</Link>
        {page === 'privacy' && <a href="#data-deletion-request">{isId ? 'Penghapusan data' : 'Data deletion'}</a>}
      </nav>
      <div className={styles.sections}>
        {sections.map(section => (
          <section key={section.id} aria-labelledby={`legal-${section.id}`}>
            <h2 id={`legal-${section.id}`}>{section.title}</h2>
            <p>{section.body}</p>
            <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>
          </section>
        ))}
      </div>
      {children}
    </>
  );
}
