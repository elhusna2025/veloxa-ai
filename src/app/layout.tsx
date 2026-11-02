import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Veloxa AI — Autonomous Social Content Studio & AI Meta Ads Agent',
  description:
    'Platform SaaS AI Otonom untuk pembuatan konten Instagram, Facebook, TikTok, YouTube Shorts, dan AI Agent Marketing Meta Ads (Web, Android, & iOS).',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased selection:bg-pink-100 selection:text-neutral-900">
        {children}
      </body>
    </html>
  );
}
