import { noStoreJson } from '@/lib/server/http';
export async function POST() {
  return noStoreJson({ ok: false, error: 'Eksekusi iklan belum diaktifkan. Fokus saat ini adalah publikasi organik Instagram/Facebook.', code: 'not_implemented' }, 501);
}
