'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './VeloxaWorkspace.module.css';

export function VeloxaWorkspaceSidebar({ label, testId, children }: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return <aside aria-label={label} data-testid={testId}
    className={`${styles.sidebar} fixed inset-y-0 z-30 hidden w-60 flex-col bg-white px-5 py-6 lg:flex`}>
    {children}
  </aside>;
}

export function VeloxaSidebarButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button"
    className={`${styles.navItem} flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${className}`} />;
}
