import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Veloxa AI — Autonomous Social Content & Meta Ads Marketing SaaS',
  description:
    'Platform SaaS AI Otonom untuk pembuatan konten Instagram, Facebook, TikTok, YouTube Shorts, dan AI Agent Marketing Meta Ads (Web, Android, iOS).',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased selection:bg-indigo-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
