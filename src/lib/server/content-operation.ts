import { createHash, randomUUID } from 'node:crypto';
import { jsonFingerprint } from '../profile-fingerprint';
import { z } from 'zod';
import { requireWorkspace, hasWorkspaceAccess } from './auth';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { businessId } from '../business-context';
import { resolveBusinessContext } from './business-contexts';
import { ApiError, errorResponse, readJson } from './http';
import { GenerationStageError } from './content-generation-stream';
import type { GenerationProgress } from '../content-generation';
import { createSocialContent, contentInput } from './content';
import { studioGenerationCheckpoint } from './studio-generation-checkpoint';

const uuid = z.string().uuid();
const leaseMs = 330_000;
const recoveryLifetime = 30 * 60_000;
const pending = () => new ApiError(202, 'Progres disimpan. Veloxa sedang melanjutkan percobaan yang sama.', 'content_operation_pending');
type Dependencies = { authorize?: typeof requireWorkspace; create?: typeof createSocialContent; now?: () => number };

export async function prepareContentOperation(request: Request, deps: Dependencies = {}) {
  const now = deps.now ?? Date.now;
  const body = await readJson(request.clone()) as Record<string, unknown>;
  contentInput.parse(body);
  const operationId = uuid.parse(body.operationId);
  const id = businessId(body.businessId);
  const { ref, user } = await (deps.authorize || requireWorkspace)(request, body.workspaceId);
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const job = ref.collection('generation_jobs').doc(operationId);
  const { operationId: omitted, ...originalInput } = body;
  const inputFingerprint = await jsonFingerprint(originalInput);
  const leaseToken = randomUUID();
  const start = await ref.firestore.runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    if (!workspace || !hasWorkspaceAccess(user.uid, workspace, isVerifiedAdmin(user))) throw new ApiError(403, 'Akses workspace berubah.');
    const existing = (await tx.get(job)).data();
    if (existing) {
      if (existing.requestHash !== hash || existing.businessId !== id || existing.createdBy !== user.uid) throw new ApiError(409, 'Identitas proses digunakan oleh permintaan lain.');
      if (!existing.body || ['complete', 'failed', 'uncertain'].includes(existing.state)) return false;
      if (existing.leaseUntil > now() || existing.retryAt > now()) return false;
      if (now() - existing.startedAt > recoveryLifetime) throw new ApiError(409, 'Jendela pemulihan berakhir. Periksa koleksi konten sebelum membuat ulang.');
      tx.update(job, { state: 'running', leaseToken, leaseUntil: now() + leaseMs, updatedAt: now() });
      return true;
    }
    tx.create(job, { body, businessId: id, createdBy: user.uid, requestHash: hash, inputFingerprint, state: 'running', stage: 'validation', startedAt: now(), updatedAt: now(), leaseToken, leaseUntil: now() + leaseMs, failures: 0 });
    return true;
  });
  const assertLease = async () => {
    const record = (await job.get()).data();
    if (record?.leaseToken !== leaseToken || record?.state !== 'running' || record.leaseUntil <= now()) throw pending();
  };
  const updateJob = async (values: Record<string, unknown>) => {
    await ref.firestore.runTransaction(async tx => {
      const record = (await tx.get(job)).data();
      if (record?.leaseToken !== leaseToken || record?.state !== 'running' || record.leaseUntil <= now()) throw pending();
      tx.update(job, values);
    });
  };
  return { operationId, start, run: async (report: (progress: GenerationProgress) => void) => {
    let writes = Promise.resolve();
    let stage: GenerationProgress['stage'] = 'validation';
    type Result = Awaited<ReturnType<typeof createSocialContent>>;
    let saved: (Omit<Result, 'generationQuota'> & { generationQuota?: Result['generationQuota'] }) | undefined;
    try {
      await assertLease();
      // Recheck current business ownership before using any checkpoint.
      const workspace = (await ref.get()).data()!;
      await resolveBusinessContext(ref, workspace, id);
      const stored = (await ref.collection('social_drafts').doc(`draft_${operationId}`).get()).data();
      if (stored?.operationId === operationId) {
        saved = { draft: stored.draft, engineMode: stored.engineMode };
      } else {
        const checkpoint = studioGenerationCheckpoint(job, assertLease, updateJob);
        saved = await (deps.create || createSocialContent)(request, {
          studioJob: job,
          ...checkpoint,
          persistStudioDraft: async (draftRef, record) => {
            await ref.firestore.runTransaction(async tx => {
              const current = (await tx.get(job)).data();
              const existing = (await tx.get(draftRef)).data();
              if (current?.leaseToken !== leaseToken || current.state !== 'running' || current.leaseUntil <= now()) throw pending();
              if (existing && existing.operationId !== operationId) throw new ApiError(409, 'Identitas draf sudah digunakan.');
              if (!existing) tx.create(draftRef, record);
            });
          },
          onProgress: event => {
            stage = event.stage;
            report(event);
            writes = writes.then(() => updateJob({ stage: event.stage, updatedAt: now() }));
            void writes.catch(() => {});
          },
        });
      }
      await writes;
      await assertLease();
      await updateJob({ state: 'complete', stage: 'saving', leaseUntil: 0, updatedAt: now(), draftId: saved.draft.id, engineMode: saved.engineMode, ...(saved.generationQuota ? { generationQuota: saved.generationQuota } : {}) });
      return saved;
    } catch (error) {
      await writes.catch(() => {});
      const failedStage = error instanceof GenerationStageError ? error.stage : stage;
      const safe = await errorResponse(error).json();
      const current = (await job.get()).data();
      if (current?.leaseToken !== leaseToken) throw new GenerationStageError(pending(), failedStage);
      const completedInvalidScript = failedStage === 'script' && safe.code === 'invalid_content_agent_response' && current.agentSession?.completed === true;
      const repairableLayout = ['reels_photo_layout_unreadable', 'scheduled_artwork_rejected'].includes(safe.code);
      const continuation = ['content_agent_pending', 'content_operation_pending'].includes(safe.code);
      const transient = error instanceof ApiError && (error.status === 429 || error.status >= 500);
      const definite = ['content_agent_creation_uncertain', 'content_agent_failed', 'content_agent_cancelled', 'content_agent_waiting', 'content_policy_violation'].includes(safe.code)
        || safe.code === 'content_agent_unavailable' && !current.agentSession;
      const failures = (current.failures || 0) + (continuation ? 0 : 1);
      const retry = !saved && failedStage !== 'saving' && now() - current.startedAt < recoveryLifetime
        && (continuation || (completedInvalidScript || repairableLayout ? failures < 4 : transient && !definite));
      const uncertain = saved || failedStage === 'saving' || safe.code === 'content_agent_creation_uncertain';
      await updateJob({
        state: retry ? 'retrying' : uncertain ? 'uncertain' : 'failed', stage: failedStage,
        error: safe.error, code: safe.code, failures, leaseUntil: 0,
        retryAt: retry ? now() + (continuation ? 1000 : Math.min(30_000, 2000 * 2 ** failures)) : 0,
        updatedAt: now(), ...(saved ? { draftId: saved.draft.id } : {}),
        ...(retry && completedInvalidScript ? { agentSession: null, scriptCreationStarted: false } : {}),
      });
      throw new GenerationStageError(retry ? pending() : error, failedStage);
    }
  } };
}

export async function readContentOperation(request: Request, workspaceId: unknown, rawBusinessId: unknown, rawOperationId: unknown, deps: { authorize?: typeof requireWorkspace; expectedInputFingerprint?: string | null } = {}) {
  const operationId = uuid.parse(rawOperationId);
  const id = businessId(rawBusinessId);
  const { ref, workspace, user } = await (deps.authorize || requireWorkspace)(request, workspaceId);
  await resolveBusinessContext(ref, workspace, id);
  const record = (await ref.collection('generation_jobs').doc(operationId).get()).data();
  if (!record || record.businessId !== id) throw new ApiError(404, 'Proses belum tercatat pada bisnis ini.');
  if (deps.expectedInputFingerprint && (!/^[a-f0-9]{64}$/.test(deps.expectedInputFingerprint) || record.inputFingerprint !== deps.expectedInputFingerprint)) throw new ApiError(409, 'Hasil ini berasal dari permintaan berbeda. Periksa proses sebelumnya secara terpisah.');
  if (record.createdBy !== user.uid && workspace.ownerUid !== user.uid && !isVerifiedAdmin(user)) throw new ApiError(403, 'Proses ini milik pengguna lain.');
  let stored = record.draftId ? (await ref.collection('social_drafts').doc(record.draftId).get()).data() : undefined;
  if (!stored && record.state !== 'failed') stored = (await ref.collection('social_drafts').where('operationId', '==', operationId).limit(1).get()).docs[0]?.data();
  if (stored?.draft?.workspaceId === ref.id && (stored.draft.businessId || 'primary') === id && stored.operationId === operationId && stored.draft.renderedMedia?.url) return { state: 'complete', stage: 'saving', result: { draft: stored.draft, engineMode: stored.engineMode, ...(record.generationQuota ? { generationQuota: record.generationQuota } : {}) } };
  const recoverable = record.body && ['running', 'retrying'].includes(record.state) && Date.now() - record.startedAt < recoveryLifetime;
  if (recoverable) return { state: 'running', stage: record.stage, resume: record.leaseUntil <= Date.now() && !(record.retryAt > Date.now()), operationId };
  if (record.state === 'complete' || record.state === 'uncertain' || record.state === 'retrying' || Date.now() - record.updatedAt > 10 * 60000) return { state: 'uncertain', stage: record.stage, error: 'Hasil proses perlu diperiksa. Muat ulang koleksi konten sebelum membuat ulang.', operationId };
  return { state: record.state, stage: record.stage, error: record.error, operationId };
}

/** Continue only the server's immutable input after workspace/business/fingerprint checks. */
export async function resumeContentOperation(request: Request) {
  const body = await readJson(request);
  const status = await readContentOperation(request, body.workspaceId, body.businessId, body.operationId, { expectedInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/).parse(body.inputFingerprint) });
  if (status.state !== 'running' || !('resume' in status) || !status.resume) return { status };
  const { ref, user } = await requireWorkspace(request, body.workspaceId);
  const record = (await ref.collection('generation_jobs').doc(uuid.parse(body.operationId)).get()).data()!;
  if (record.createdBy !== user.uid) throw new ApiError(403, 'Hanya pembuat yang dapat melanjutkan proses ini.');
  const resumed = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(record.body) });
  return { operation: await prepareContentOperation(resumed) };
}
