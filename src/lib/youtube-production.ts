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
};
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
