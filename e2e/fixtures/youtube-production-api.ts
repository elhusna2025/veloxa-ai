import { parseYouTubeScript } from '../../src/lib/youtube-script-import';
import type { YouTubeProduction } from '../../src/lib/youtube-production';
// Browser fixture only. No Firebase sessions, paid AI calls or external writes.
const requestedState = new URLSearchParams(location.search).get('state') || 'empty';
const state = ['retry', 'audio', 'render', 'merge'].includes(requestedState) ? 'producing' : requestedState;
const narration = 'Mari kita pahami langkah pertama dengan contoh sederhana agar setiap orang mengetahui alasan dan tujuan sebelum mencoba cara yang sama pada kegiatan usaha mereka sendiri hari ini.';
const characters = Array.from({ length: 5 }, (_, index) => ({ id: `actor_${index + 1}`, name: ['Rani', 'Budi', 'Mira', 'Doni', 'Sari'][index], appearance: 'Rambut pendek, kemeja biru, usia sekitar tiga puluh tahun.', voice: ['cedar', 'coral', 'ash', 'sage', 'shimmer'][index], delivery: 'Hangat dan tenang.' }));
const item = { aiUsage: { partial: true, stages: { images: { calls: 1, usd: .035, unpriced: 0, input: 100, output: 1100, characters: 0 } } }, id: '00000000-0000-4000-8000-000000000001', revision: 1, state,
  settings: { kind: 'video', minutes: 15, topic: 'Mengelola catatan usaha melalui percakapan lima pemeran.', direction: '', voice: 'marin', delivery: 'Hangat', characters },
  outline: { title: 'Catatan Usaha yang Lebih Terarah', description: 'Contoh ilustratif.', chapters: ['Mulai dari satu catatan'] },
  blocks: [{ index: 0, chapter: 'Mulai dari satu catatan', scenes: Array.from({ length: 4 }, (_, index) => ({ title: 'Mulai dari catatan usaha', supporting: 'Pahami manfaat lewat contoh sederhana.', narration, visual: 'Pengelola usaha memeriksa catatan transaksi.', characterIds: ['actor_1'], lines: [{ speakerId: 'actor_' + (index + 1), text: narration }] })) }],
  progress: { images: ['audio','render','merge'].includes(requestedState) ? 60 : requestedState === 'cancelled' ? 10 : requestedState === 'producing' ? 2 : 0, audio: ['render','merge'].includes(requestedState) ? 15 : 0, rendered: requestedState === 'merge' ? 60 : requestedState === 'render' ? 2 : 0, characters: 5, attempts: requestedState === 'retry' ? 3 : 0, working: requestedState !== 'retry', checkedAt: Date.now() },
  ...(requestedState === 'retry' ? { retryAt: Date.now() + 60000 } : {}),
  portraits: characters.map(actor => actor.id), completedScenes: 0, createdAt: 1, updatedAt: 1, durationSeconds: 900 };
let imported: YouTubeProduction | undefined;
export async function veloxaApi(path: string, init?: RequestInit) {
  if (path.includes('/media/')) return { ready: true };
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.scriptText) {
      const blocks = parseYouTubeScript(body.scriptText, body.settings.characters);
      imported = { id: body.id, settings: body.settings, state: 'script_review', scriptSource: 'imported', revision: 1, blocks,
        outline: { title: body.settings.topic, description: '', chapters: blocks.map(block => block.chapter) },
        completedScenes: 0, createdAt: 1, updatedAt: 1 };
      return { production: imported };
    }
    if (imported && body.action === 'edit') {
      imported.blocks[body.index].scenes = body.block.scenes;
      imported.revision++;
      return { production: imported };
    }
    if (body.action === 'resume' && item.state === 'cancelled') {
      item.state = 'producing';
      item.revision++;
      return { production: { ...item } };
    }
    if (body.action === 'suggest_edit') {
      const proposal = structuredClone(item.blocks[body.index]);
      proposal.scenes[0].title = 'Pembukaan baru dari AI';
      return { proposal };
    }
    if (body.action === 'edit') item.blocks[body.index].scenes = body.block.scenes;
    return { production: item };
  }
  if (path.includes(item.id)) return { production: item };
  if (state !== 'empty') item.blocks = Array.from({ length: 15 }, (_, index) => ({ ...item.blocks[0], index }));
  return { productions: state === 'empty' ? [] : [item] };
}
export function youtubeUploadApi() { return { permission: async () => ({ connection: null, canUpload: false, uploadStorageReady: false }), list: async () => ({ operations: [] }) }; }
export function verifiedGoogleAuthorization() { throw new Error('External navigation disabled in fixture'); }
export function youtubeUploadReturnKey(id: string) { return id; }
