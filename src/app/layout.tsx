import type { Metadata, Viewport } from 'next';
import './globals.css';
import './workspace-overview.css';
import { CanonicalAppOrigin } from '../components/CanonicalAppOrigin';

export const metadata: Metadata = {
  title: 'Veloxa AI — Studio Konten untuk Instagram dan Facebook',
  description:
    'Buat post, carousel, dan Reels dari ide dan aset brand Anda. Tinjau draf, pilih akun tujuan, dan jadwalkan publikasi Instagram atau Facebook di Veloxa AI.',
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
      <body className="veloxa-app-ui min-h-dvh bg-white text-neutral-900 antialiased selection:bg-pink-100 selection:text-neutral-900">
        <CanonicalAppOrigin />
        {children}
      </body>
    </html>
  );
}
