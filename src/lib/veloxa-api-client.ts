import { ContentGenerationError, readGenerationStream, type GenerationProgress } from './content-generation';
import { getFirebaseAuthInstance } from './veloxa-auth';

/** Only send Firebase credentials to our own API, never to arbitrary URLs. */
export async function veloxaApi<T>(path: string, init: RequestInit = {}, feedback?: { onProgress: (progress: GenerationProgress) => void }): Promise<T> {
  if (!path.startsWith('/api/veloxa/')) throw new Error('Alamat layanan Veloxa tidak valid.');
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Firebase belum dikonfigurasi.');
  await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Silakan masuk ke akun Anda.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  if (feedback) headers.set('Accept', 'application/x-ndjson');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.ok && feedback && response.headers.get('Content-Type')?.includes('application/x-ndjson')) return readGenerationStream<T>(response, feedback.onProgress);
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('API Veloxa belum aktif pada domain ini. Periksa deployment server.');
  const data = await response.json();
  if (!response.ok) { const message = data.error || 'Permintaan belum berhasil. Silakan coba lagi.'; if (feedback) throw new ContentGenerationError(message); throw new Error(message); }
  return data as T;
}
