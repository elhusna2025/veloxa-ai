import { z } from 'zod';

export const youtubeVoices = ['marin', 'cedar', 'coral', 'ash', 'sage', 'shimmer', 'echo', 'alloy', 'ballad', 'verse'] as const;
export const youtubeVoiceSchema = z.enum(youtubeVoices);
export const youtubeCharacterSchema = z.object({
  id: z.string().regex(/^actor_[1-5]$/),
  name: z.string().trim().min(1).max(60),
  appearance: z.string().trim().min(15).max(1000),
  voice: youtubeVoiceSchema,
  delivery: z.string().trim().max(500),
}).strict();
export const youtubeProductionSettings = z.object({
  kind: z.enum(['short', 'video']),
  minutes: z.number().int().min(1).max(120),
  topic: z.string().trim().min(8).max(4000),
  direction: z.string().trim().max(2000).default(''),
  voice: youtubeVoiceSchema,
  delivery: z.string().trim().max(800).default(''),
  characters: z.array(youtubeCharacterSchema).max(5).default([]),
}).strict().refine(value => value.kind !== 'short' || value.minutes === 1, 'Shorts memakai durasi satu menit.');

export type YouTubeProductionSettings = z.infer<typeof youtubeProductionSettings>;
export const youtubeSceneSchema = z.object({
  title: z.string().trim().min(1).max(48),
  supporting: z.string().trim().min(1).max(110),
  narration: z.string().trim().min(20).max(650),
  lines: z.array(z.object({ speakerId: z.string().regex(/^(narrator|actor_[1-5])$/), text: z.string().trim().min(1).max(650) }).strict()).min(1).max(6),
  characterIds: z.array(z.string().regex(/^actor_[1-5]$/)).max(5),
  visual: z.string().trim().min(20).max(1200),
}).strict();
export const youtubeBlockSchema = z.object({ scenes: z.array(youtubeSceneSchema).length(4) }).strict();
export type YouTubeScene = z.infer<typeof youtubeSceneSchema>;
export type YouTubeScriptBlock = z.infer<typeof youtubeBlockSchema> & { index: number; chapter: string };
export type YouTubeOutline = { title: string; description: string; chapters: string[] };
export type YouTubeProductionState = 'planning' | 'scripting' | 'script_review' | 'characters' | 'character_review' | 'producing' | 'ready' | 'cancelled' | 'attention';
export type YouTubeProduction = {
  id: string; revision: number; settings: YouTubeProductionSettings; state: YouTubeProductionState;
  outline?: YouTubeOutline; blocks: YouTubeScriptBlock[]; completedScenes: number;
  createdAt: number; updatedAt: number; retryAt?: number; message?: string;
  durationSeconds?: number; videoBytes?: number;
  portraits?: string[];
  progress?: { images: number; audio: number; rendered: number; characters: number; attempts: number; working: boolean; checkedAt: number };
};
export type ProductionProgressStep = { id: string; label: string; done: number; total: number; status: 'complete' | 'current' | 'waiting' };
export function productionProgress(value: YouTubeProduction) {
  const count = productionResources(value.settings).scenes, p = value.progress;
  const bounded = (n: number | undefined, total: number) => Math.max(0, Math.min(total, Number.isFinite(n) ? Math.floor(n!) : 0));
  const scripts = bounded(value.blocks.length, value.settings.minutes);
  const rows = [
    { id: 'script', label: 'Naskah', done: scripts + (value.outline ? 1 : 0), total: value.settings.minutes + 1 },
    ...(value.settings.characters.length ? [{ id: 'characters', label: 'Karakter & contoh suara', done: bounded(p?.characters ?? value.portraits?.length, value.settings.characters.length), total: value.settings.characters.length }] : []),
    { id: 'images', label: 'Gambar adegan', done: bounded(p?.images, count), total: count },
    { id: 'audio', label: 'Narasi & dialog', done: bounded(p?.audio, value.settings.minutes), total: value.settings.minutes },
    { id: 'render', label: 'Video akhir', done: bounded(p?.rendered ?? value.completedScenes, count) + (value.state === 'ready' ? 1 : 0), total: count + 1 },
  ];
  // A completed production confirms all stages, including records predating detailed counters.
  if (value.state === 'ready') rows.forEach(row => { row.done = row.total; });
  const first = rows.findIndex(row => row.done < row.total);
  const steps: ProductionProgressStep[] = rows.map((row, index) => ({ ...row, status: row.done === row.total ? 'complete' : index === first ? 'current' : 'waiting' }));
  const phase = first < 0 ? 'complete' : rows[first].id;
  let detail = phase === 'script' ? value.outline ? `Menulis naskah menit ${Math.min(scripts + 1, value.settings.minutes)} dari ${value.settings.minutes}` : 'Menyusun alur dan kerangka video'
    : phase === 'characters' ? `Membuat acuan karakter dan contoh suara ${Math.min((p?.characters ?? 0) + 1, value.settings.characters.length)} dari ${value.settings.characters.length}`
    : phase === 'images' ? p ? `Membuat gambar adegan ${Math.min(p.images + 1, count)} dari ${count}` : 'Menyiapkan gambar dan suara'
    : phase === 'audio' ? `Membuat suara untuk menit ${Math.min((p?.audio ?? 0) + 1, value.settings.minutes)} dari ${value.settings.minutes}`
    : phase === 'render' ? (p?.rendered ?? value.completedScenes) >= count ? 'Menggabungkan adegan menjadi video akhir' : `Merender adegan ${Math.min((p?.rendered ?? value.completedScenes) + 1, count)} dari ${count}` : 'Video selesai dan siap diputar';
  if (value.state === 'script_review') detail = 'Naskah selesai. Menunggu tinjauan Anda sebelum membuat media.';
  if (value.state === 'character_review') detail = 'Acuan karakter selesai. Menunggu tinjauan Anda sebelum membuat adegan.';
  if (value.state === 'cancelled') detail = 'Produksi dihentikan. Bagian yang sudah selesai tetap tersimpan.';
  return { steps, phase, detail, done: rows.reduce((sum, row) => sum + row.done, 0), total: rows.reduce((sum, row) => sum + row.total, 0) };
}
export function productionResources(settings: YouTubeProductionSettings) {
  return { minutes: settings.minutes, blocks: settings.minutes, scenes: settings.minutes * 4,
    minWords: settings.minutes * 105, maxWords: settings.minutes * 125,
    width: settings.kind === 'short' ? 720 : 1280, height: settings.kind === 'short' ? 1280 : 720 };
}
export function scriptWords(scenes: YouTubeScene[]) {
  return scenes.reduce((count, scene) => count + scene.narration.trim().split(/\s+/u).length, 0);
}
export function validateScriptBlock(value: unknown): z.infer<typeof youtubeBlockSchema> {
  const block = youtubeBlockSchema.parse(value);
  const words = scriptWords(block.scenes);
  if (words < 105 || words > 125) throw new Error('Setiap menit membutuhkan 105–125 kata narasi.');
  for (const scene of block.scenes) {
    if (scene.lines.map(line => line.text).join(' ').replace(/\s+/gu, ' ').trim() !== scene.narration.replace(/\s+/gu, ' ').trim()) throw new Error('Dialog dan narasi adegan harus sama.');
  }
  return block;
}
export function validateCast(block: YouTubeScriptBlock, settings: YouTubeProductionSettings) {
  const ids = new Set(settings.characters.map(character => character.id));
  if (ids.size !== settings.characters.length) throw new Error('ID karakter harus unik.');
  for (const scene of block.scenes) {
    if (scene.characterIds.some(id => !ids.has(id)) || scene.lines.some(line => line.speakerId !== 'narrator' && !ids.has(line.speakerId))) throw new Error('Adegan memakai karakter di luar daftar pemeran.');
  }
}
export const productionStageLabel: Record<YouTubeProductionState, string> = {
  planning: 'Menyusun alur dan bab', scripting: 'Menulis naskah tiap adegan', script_review: 'Naskah siap ditinjau',
  producing: 'Memproduksi gambar, suara, dan video', ready: 'Video siap ditinjau',
  characters: 'Membuat acuan karakter', character_review: 'Acuan karakter siap ditinjau',
  cancelled: 'Dihentikan', attention: 'Perlu diperiksa',
};
