/** Shared, credential-free generation feedback protocol. No estimated percentages. */
export const GENERATION_STAGES = ['sync', 'validation', 'references', 'script', 'images', 'media', 'voiceover', 'rendering', 'saving'] as const;
export type GenerationStage = typeof GENERATION_STAGES[number];
export interface GenerationQuota { mode: 'standard' | 'development'; dailyLimit: number | null; used: number; day: string }
export interface GenerationProgress { stage: GenerationStage }
export interface GenerationFeedback { status: 'running' | 'success' | 'error'; stage: GenerationStage; message?: string; requestId?: string; uncertain?: boolean }
export const GENERATION_LABELS: Record<GenerationStage, string> = {
  sync: 'Menyimpan profil bisnis', validation: 'Memeriksa akun dan kuota', references: 'Memuat foto referensi', script: 'Menyusun naskah dan caption',
  images: 'Membuat visual konten', media: 'Membuat visual dan voiceover', voiceover: 'Membuat voiceover',
  rendering: 'Merangkai video Reels', saving: 'Menyimpan draf dan media',
};
export function isGenerationStage(value: unknown): value is GenerationStage { return typeof value === 'string' && (GENERATION_STAGES as readonly string[]).includes(value); }
export class ContentGenerationError extends Error {
  constructor(message: string, public stage?: GenerationStage, public requestId?: string, public uncertain = false) { super(message); }
}
/** Decode chunked UTF-8, report real server stages, and require an explicit terminal event. */
export async function readGenerationStream<T>(response: Response, onProgress: (progress: GenerationProgress) => void): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) throw new ContentGenerationError('Respons proses tidak diterima. Periksa koleksi konten sebelum membuat ulang.', undefined, undefined, true);
  const decoder = new TextDecoder(); let pending = ''; let stage: GenerationStage | undefined; let requestId: string | undefined;
  const incomplete = () => new ContentGenerationError('Koneksi proses terputus. Hasil belum dapat dipastikan; periksa koleksi konten sebelum membuat ulang.', stage, requestId, true);
  function consume(line: string): { value: T } | undefined {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (typeof event.requestId === 'string' && /^[a-f0-9-]{36}$/.test(event.requestId)) requestId = event.requestId;
    if (event.type === 'progress' && isGenerationStage(event.stage)) { stage = event.stage; onProgress({ stage: event.stage }); }
    if (event.type === 'error') throw new ContentGenerationError(typeof event.error === 'string' ? event.error : 'Konten belum dapat dibuat.', isGenerationStage(event.stage) ? event.stage : stage, requestId, event.uncertain === true);
    if (event.type === 'complete' && event.data?.draft?.id && event.data?.draft?.renderedMedia?.url) return { value: event.data as T };
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 1024 * 1024) throw incomplete();
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); const result = consume(line); if (result) return result.value; }
      if (done) { if (pending.trim()) { const result = consume(pending); if (result) return result.value; } throw incomplete(); }
    }
  } catch (error) { if (error instanceof ContentGenerationError) throw error; throw incomplete(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
