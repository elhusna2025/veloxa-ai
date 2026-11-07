import { noStoreJson } from '@/lib/server/http';
export async function POST() {
  return noStoreJson({ ok: false, error: 'Pembayaran belum diaktifkan. Integrasi Duitku sedang disiapkan.', code: 'billing_pending' }, 501);
}
