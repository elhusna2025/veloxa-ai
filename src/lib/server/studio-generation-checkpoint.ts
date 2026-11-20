import { createHash } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { generateContentWithSavedAgent } from './content-agent';
import { generateSocialPostImage } from './content-image';
import { adminBucket } from './firebase';
import { ApiError } from './http';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** These checkpoints are server-only and belong to one immutable Studio operation. */
export function studioGenerationCheckpoint(
  job: DocumentReference,
  assertLease: () => Promise<void>,
  updateJob: (values: Record<string, unknown>) => Promise<void>,
  bucket = adminBucket,
  providers: { generate?: typeof generateContentWithSavedAgent; renderImage?: typeof generateSocialPostImage } = {},
) {
  return {
    generate: (async (params, options) => {
      const key = digest(JSON.stringify({ params, model: options?.model }));
      const record = (await job.get()).data()!;
      if (record.scriptKey && record.scriptKey !== key) {
        throw new ApiError(409, 'Profil atau pengaturan berubah. Mulai draf baru setelah memeriksa hasil sebelumnya.', 'profile_conflict');
      }
      if (record.scriptResult) return record.scriptResult;
      // A lost creation reply must never create a replacement paid session.
      if (record.scriptCreationStarted && !record.agentSession) {
        throw new ApiError(503, 'Identitas proses naskah perlu diperiksa sebelum dilanjutkan.', 'content_agent_creation_uncertain');
      }
      await assertLease();
      await updateJob({ scriptKey: key, scriptCreationStarted: true });
      const result = await (providers.generate ?? generateContentWithSavedAgent)(params, {
        ...options,
        checkpoint: {
          load: async () => (await job.get()).data()?.agentSession ?? null,
          save: async value => { await updateJob({ agentSession: value }); },
        },
      });
      await assertLease();
      await updateJob({ scriptResult: JSON.parse(JSON.stringify(result)) });
      return result;
    }) as typeof generateContentWithSavedAgent,
    renderImage: (async (params, options) => {
      // Reels checkpoints store the reviewed frame and audio together in content.ts.
      if (params.aspectRatio === '9:16') return (providers.renderImage || generateSocialPostImage)(params, options);
      const key = digest(JSON.stringify({ params, model: options?.model }, (_key, value) =>
        value?.type === 'Buffer' && Array.isArray(value.data) ? digest(Buffer.from(value.data)) : value));
      const file = bucket().file(`private_studio_checkpoints/${job.parent.parent!.id}/${job.id}/${key}.jpg`);
      try {
        const [bytes] = await file.download();
        if (bytes.length) return bytes;
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      await assertLease();
      const image = await (providers.renderImage ?? generateSocialPostImage)(params, options);
      await assertLease();
      await file.save(image, { resumable: false, metadata: { contentType: 'image/jpeg', cacheControl: 'private, no-store' } });
      return image;
    }) as typeof generateSocialPostImage,
  };
}
