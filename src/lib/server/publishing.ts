import { z } from 'zod';
import { adminBucket, adminDb } from './firebase';
import { hasWorkspaceAccess, requireWorkspace } from './auth';
import { ApiError, readJson } from './http';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { wibMonth } from './clock';
import { decryptMetaToken } from './meta-crypto';
import { MetaRequestError, publishMetaImage, type MetaConnection, type MetaChannel } from './meta-graph';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import type { ContentDraft, SubscriptionPlanId } from '../veloxa-types';

export interface PublishReceipt {
  channel: MetaChannel;
  status: 'published' | 'failed' | 'unknown';
  externalPostId?: string;
  permalink?: string;
  error?: string;
  publishedAt?: string;
}
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const publishInput = z.object({ workspaceId: z.string(), draftId: z.string().regex(/^draft_[a-zA-Z0-9_-]+$/) }).strict();

export function publicationState(receipts: PublishReceipt[]): ContentDraft['status'] {
  if (receipts.length && receipts.every(receipt => receipt.status === 'published')) return 'published';
  if (receipts.some(receipt => receipt.status === 'unknown')) return 'needs_attention';
  return receipts.some(receipt => receipt.status === 'published') ? 'partially_published' : 'publish_failed';
}

export async function publishSocialContent(request: Request, dependencies: {
  authorize?: typeof requireWorkspace;
  database?: ReturnType<typeof adminDb>;
  storage?: ReturnType<typeof adminBucket>;
  publisher?: typeof publishMetaImage;
  decrypt?: typeof decryptMetaToken;
} = {}) {
  const input = publishInput.parse(await readJson(request));
  const { ref, user } = await (dependencies.authorize || requireWorkspace)(request, input.workspaceId);
  const db = dependencies.database || adminDb();
  const draftRef = ref.collection('social_drafts').doc(input.draftId);
  const jobRef = ref.collection('publish_jobs').doc(input.draftId);
  const month = wibMonth();
  const usageRef = ref.collection('publish_usage').doc(month);
  const stored = (await draftRef.get()).data();
  const draft = stored?.draft as ContentDraft | undefined;
  if (!draft || draft.workspaceId !== ref.id || draft.format !== 'single_post' || !draft.renderedMedia || !stored?.storagePath?.startsWith(`workspaces/${ref.id}/renders/`)) throw new ApiError(409, 'Buat gambar post tunggal di Studio Veloxa sebelum menerbitkan.');
  if (!draft.qualityReview.passed) throw new ApiError(409, 'Konten belum lolos pemeriksaan teks. Perbaiki draf terlebih dahulu.');
  const caption = [draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n');
  if ([...caption].length > 2200) throw new ApiError(400, 'Caption dan hashtag melebihi 2.200 karakter.');
  const targets = draft.targetChannels;
  if (!targets.length || targets.some(channel => channel !== 'facebook' && channel !== 'instagram')) throw new ApiError(409, 'Pilih koneksi Instagram/Facebook yang telah diverifikasi.');

  const claim = await db.runTransaction(async tx => {
    const [jobSnap, usageSnap, wsSnap, ...connectionSnaps] = await tx.getAll(jobRef, usageRef, ref, ...targets.map(channel => ref.collection('private_meta_connections').doc(channel)));
    const job = jobSnap.data();
    const workspace = wsSnap.data();
    if (!workspace || !hasWorkspaceAccess(user.uid, workspace, isVerifiedAdmin(user))) throw new ApiError(403, 'Akses workspace telah berubah.');
    if (job?.state === 'processing' || job?.state === 'needs_attention') throw new ApiError(409, 'Publikasi sedang diproses atau hasilnya perlu diperiksa di akun Meta. Jangan kirim ulang.', 'delivery_in_progress');
    const receipts = (job?.receipts || []) as PublishReceipt[];
    if (job?.state === 'published') return { alreadyPublished: true, receipts };
    for (let index = 0; index < targets.length; index++) {
      const connection = connectionSnaps[index].data();
      if (!connection || (connection.expiresAt && connection.expiresAt <= Date.now())) throw new ApiError(409, 'Sambungkan kembali seluruh akun tujuan sebelum menerbitkan.');
      if (connection.accountId !== stored.targetAccounts?.[targets[index]]) throw new ApiError(409, 'Akun tujuan berubah sejak draf dibuat. Buat draf baru dan tinjau akun tujuan kembali.', 'target_changed');
    }
    const planId = Object.hasOwn(SUBSCRIPTION_PLANS, String(workspace.subscriptionPlanId)) ? workspace.subscriptionPlanId as SubscriptionPlanId : 'free_trial';
    const plan = SUBSCRIPTION_PLANS[planId];
    if (targets.some(channel => !plan.allowedChannels.includes(channel))) throw new ApiError(403, 'Kanal tidak termasuk dalam paket workspace.');
    let reservedMonth = job?.reservedMonth || month;
    if (!job?.quotaReserved) {
      const used = Number(usageSnap.data()?.count || 0);
      if (!Number.isSafeInteger(used) || used < 0 || used >= plan.monthlyPostQuota) throw new ApiError(429, 'Kuota publikasi bulan ini habis.', 'quota_exhausted');
      tx.set(usageRef, { count: used + 1 }, { merge: true });
      tx.update(ref, { quotaUsed: used + 1 });
      reservedMonth = month;
    }
    tx.set(jobRef, { state: 'processing', receipts, quotaReserved: true, reservedMonth, startedAt: Date.now(), requestedBy: user.uid }, { merge: true });
    tx.update(draftRef, { 'draft.status': 'publishing' });
    return { alreadyPublished: false, receipts };
  });
  if (claim.alreadyPublished) return { draft: { ...draft, status: 'published' }, receipts: claim.receipts, quotaUsed: Number((await usageRef.get()).data()?.count || 0) };

  const receipts = [...claim.receipts];
  // Every successful remote send is persisted before moving to the next channel.
  // A lost response or a worker crash blocks automatic retry rather than risking duplicate posts.
  for (const channel of targets as MetaChannel[]) {
    if (receipts.some(receipt => receipt.channel === channel && receipt.status === 'published')) continue;
    const previous = receipts.findIndex(receipt => receipt.channel === channel);
    if (previous >= 0) receipts.splice(previous, 1);
    let receipt: PublishReceipt;
    let dispatched = false;
    let connection: MetaConnection | undefined;
    try {
      connection = (await ref.collection('private_meta_connections').doc(channel).get()).data() as MetaConnection | undefined;
      if (!connection || (connection.expiresAt && connection.expiresAt <= Date.now())) throw new ApiError(409, 'Akun belum terhubung atau izin berakhir. Hubungkan ulang akun.');
      if (connection.accountId !== stored.targetAccounts?.[channel]) throw new ApiError(409, 'Akun tujuan berubah saat publikasi. Tidak ada konten dikirim ke akun baru.');
      const [bytes] = await (dependencies.storage || adminBucket()).file(stored.storagePath).download();
      const token = (dependencies.decrypt || decryptMetaToken)(connection.encryptedToken, ref.id);
      dispatched = true;
      const result = await (dependencies.publisher || publishMetaImage)({ channel, accountId: connection.accountId, token, imageUrl: draft.renderedMedia.url, imageBytes: bytes, caption });
      receipt = { channel, status: 'published', ...result, publishedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof MetaRequestError && [10, 190, 200].includes(error.providerCode || 0)) {
        await ref.collection('private_meta_connections').doc(channel).update({ expiresAt: Date.now() - 1 }).catch(() => undefined);
        await ref.collection('connections').doc(channel).update({ connected: false, oauthMode: 'pending_review' }).catch(() => undefined);
        if (connection?.pageId) await ref.collection('meta_authorizations').doc(connection.pageId).update({ expiresAt: Date.now() - 1 }).catch(() => undefined);
      }
      receipt = { channel, status: error instanceof MetaRequestError && error.uncertain ? 'unknown' : error instanceof ApiError || !dispatched ? 'failed' : 'unknown', error: error instanceof ApiError ? error.message : dispatched ? 'Hasil publikasi belum dapat dipastikan. Periksa akun sebelum mencoba ulang.' : 'Media atau koneksi belum dapat dibaca. Belum ada konten dikirim ke kanal ini.' };
    }
    receipts.push(clean(receipt));
    try { await jobRef.update({ receipts }); }
    catch { throw new ApiError(409, 'Hasil kirim belum tersimpan. Periksa akun Meta sebelum mencoba ulang.', 'delivery_unknown'); }
    if (receipt.status === 'published') {
      await ref.collection('private_meta_connections').doc(channel).update({ lastPublishedAt: receipt.publishedAt }).catch(() => undefined);
      await ref.collection('connections').doc(channel).update({ lastPublishedAt: receipt.publishedAt }).catch(() => undefined);
    }
  }
  const state = publicationState(receipts);
  const updated: ContentDraft = clean({ ...draft, status: state, publishedAtWib: state === 'published' ? new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : undefined,
    channelStatuses: receipts.map(receipt => ({ channel: receipt.channel, status: receipt.status, permalink: receipt.permalink, publishedAt: receipt.publishedAt, note: receipt.error })) });
  await db.runTransaction(async tx => {
    const job = (await tx.get(jobRef)).data()!;
    const reservedRef = ref.collection('publish_usage').doc(job.reservedMonth);
    const usage = (await tx.get(reservedRef)).data();
    // Definitive failure on every channel releases the reservation; unknown delivery keeps it.
    if (state === 'publish_failed' && job.quotaReserved) {
      const count = Math.max(0, Number(usage?.count || 0) - 1);
      tx.set(reservedRef, { count }, { merge: true });
      if (job.reservedMonth === month) tx.update(ref, { quotaUsed: count });
      tx.update(jobRef, { quotaReserved: false });
    }
    tx.update(jobRef, { state, completedAt: Date.now() });
    tx.update(draftRef, { draft: updated });
  });
  return { draft: updated, receipts, quotaUsed: Number((await usageRef.get()).data()?.count || 0) };
}
