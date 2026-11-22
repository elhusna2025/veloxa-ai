// Browser fixture only. No Firebase sessions, paid AI calls or external writes.
const state = new URLSearchParams(location.search).get('state') || 'empty';
const narration = 'Mari kita pahami langkah pertama dengan contoh sederhana agar setiap orang mengetahui alasan dan tujuan sebelum mencoba cara yang sama pada kegiatan usaha mereka sendiri hari ini.';
const characters = Array.from({ length: 5 }, (_, index) => ({ id: `actor_${index + 1}`, name: ['Rani', 'Budi', 'Mira', 'Doni', 'Sari'][index], appearance: 'Rambut pendek, kemeja biru, usia sekitar tiga puluh tahun.', voice: ['cedar', 'coral', 'ash', 'sage', 'shimmer'][index], delivery: 'Hangat dan tenang.' }));
const item = { id: '00000000-0000-4000-8000-000000000001', revision: 1, state,
  settings: { kind: 'video', minutes: 15, topic: 'Mengelola catatan usaha melalui percakapan lima pemeran.', direction: '', voice: 'marin', delivery: 'Hangat', characters },
  outline: { title: 'Catatan Usaha yang Lebih Terarah', description: 'Contoh ilustratif.', chapters: ['Mulai dari satu catatan'] },
  blocks: [{ index: 0, chapter: 'Mulai dari satu catatan', scenes: Array.from({ length: 4 }, (_, index) => ({ title: 'Mulai dari catatan usaha', supporting: 'Pahami manfaat lewat contoh sederhana.', narration, visual: 'Pengelola usaha memeriksa catatan transaksi.', characterIds: ['actor_1'], lines: [{ speakerId: 'actor_' + (index + 1), text: narration }] })) }],
  portraits: characters.map(actor => actor.id), completedScenes: 0, createdAt: 1, updatedAt: 1, durationSeconds: 900 };
export async function veloxaApi(path: string, init?: RequestInit) {
  if (path.includes('/media/')) return { ready: true };
  if (init?.method === 'POST') return { production: item };
  if (path.includes(item.id)) return { production: item };
  return { productions: state === 'empty' ? [] : [item] };
}
export function youtubeUploadApi() { return { permission: async () => ({ connection: null, canUpload: false, uploadStorageReady: false }), list: async () => ({ operations: [] }) }; }
export function verifiedGoogleAuthorization() { throw new Error('External navigation disabled in fixture'); }
export function youtubeUploadReturnKey(id: string) { return id; }
