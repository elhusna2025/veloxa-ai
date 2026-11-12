import { FieldPath, type Firestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  ATTENTION_STATES, RECOVERY_STATES, type AdminJob, type AdminOperations, type AdminOverview,
  type AdminPauseAudit, type AdminReceipt, type AdminRule, type AdminWorkspace, type AdminWorkspaceDetail, type AdminWorkspacePage,
} from '../admin-operations';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { requirePlatformOperator, requireUser, workspaceIdSchema } from './auth';
import { ruleKey, schedulerHealth } from './autonomy-api';
import { loadBusinessContexts } from './business-contexts';
import { wibDay } from './clock';
import { adminDb } from './firebase';
import { generationQuotaStatus } from './generation-policy';
import { ApiError, readJson } from './http';
import { readPublicationQuota } from './publication-quota';
import { readSocialAccounts } from './social-accounts';

type Data = Record<string, unknown>;
const DAY = 86_400_000;
const WORKSPACE_PAGE = 25;
const PUBLISH_WINDOW_LIMIT = 500;
const RULE_LIMIT = 25;
const businessKey = z.string().regex(/^(primary|b_[a-f0-9-]{36})$/);
const pauseInput = z.object({
  workspaceId: workspaceIdSchema, businessId: businessKey,
  expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(240),
}).strict();
const pageCursor = z.tuple([z.string().max(1500), workspaceIdSchema]);
const millis = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const plain = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 150) : fallback;
const planId = (value: unknown) => typeof value === 'string' && Object.hasOwn(SUBSCRIPTION_PLANS, value) ? value as keyof typeof SUBSCRIPTION_PLANS : 'free_trial';
const workspaceSummary = (id: string, row: Data): AdminWorkspace => ({
  id, name: plain(row.name, id), plan: SUBSCRIPTION_PLANS[planId(row.subscriptionPlanId)].name, onboarded: row.onboardingCompleted === true,
});

function allowedPermalink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.instagram.com', 'instagram.com', 'www.facebook.com', 'facebook.com', 'fb.watch'].includes(url.hostname)) return null;
    // Some Facebook links identify the post through these parameters. Drop everything else.
    for (const key of new Set(url.searchParams.keys())) {
      if (!['story_fbid', 'id', 'fbid', 'v'].includes(key) || !/^\d+$/.test(url.searchParams.get(key) || '')) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function adminReceipts(value: unknown): AdminReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): AdminReceipt[] => {
    if (!row || (row.channel !== 'facebook' && row.channel !== 'instagram') ||
      (row.status !== 'published' && row.status !== 'failed' && row.status !== 'unknown')) return [];
    return [{
      channel: row.channel, account: plain(row.handle) ? '@' + plain(row.handle).replace(/^@/, '') : plain(row.accountName, row.channel),
      status: row.status, permalink: row.status === 'published' ? allowedPermalink(row.permalink) : null,
    }];
  });
}

function ruleIssue(value: unknown): string | null {
  const error = plain(value);
  if (!error) return null;
  if (/kuota publikasi/i.test(error)) return 'Kuota publikasi habis. Periksa paket dan pemakaian workspace.';
  if (/akun tujuan|kanal tujuan|izin.*berakhir/i.test(error)) return 'Periksa akun tujuan, izin, dan paket workspace.';
  if (/profil|referensi|logo/i.test(error)) return 'Periksa profil atau aset bisnis yang dipakai aturan.';
  if (/pemilik workspace/i.test(error)) return 'Pemilik workspace berubah. Periksa aturan sebelum mengaktifkannya lagi.';
  return 'Periksa aktivitas dan hasil di akun tujuan sebelum melanjutkan.';
}

export function countConfirmedToday(rows: { path: string; receipts: unknown }[], dayStart: number) {
  return new Set(rows.filter(({ receipts }) => Array.isArray(receipts) && receipts.some(row => {
    if (row?.status !== 'published' || (!plain(row.externalPostId) && !plain(row.providerContainerId))) return false;
    const at = Date.parse(row.publishedAt || row.confirmedAt || '');
    return at >= dayStart && at < dayStart + DAY;
  })).map(row => row.path)).size;
}

function toRule(row: Data, workspaceId: string, businessId: string, workspaceName: string, businessName: string): AdminRule {
  return { workspaceId, businessId, workspaceName, businessName,
    revision: Number.isSafeInteger(row.revision) ? Number(row.revision) : 0,
    enabled: row.enabled === true, processing: Boolean(row.processingJob),
    reconciling: typeof row.pendingReconciliation === 'string',
    nextSlot: millis(row.nextSlotMs), issue: ruleIssue(row.lastError),
  };
}

function toJob(doc: QueryDocumentSnapshot, rule: AdminRule, pending?: ReturnType<typeof pendingInfo>): AdminJob {
  const row = doc.data();
  const state = row.state === 'needs_attention' && pending?.reconciling === doc.id ? 'reconciling' : plain(row.state, 'unknown');
  return {
    id: doc.id, rule, state, scheduledAt: millis(row.scheduledAt),
    retryAt: millis(row.retryAt) || (row.state === 'queued' && pending?.id === doc.id ? pending.due : null),
    format: plain(row.format) || null,
    generationAttempts: millis(row.generationAttempts),
    // The worker initializes this counter to 1 during generation, before an actual send.
    publicationAttempts: row.state === 'publishing' || (Array.isArray(row.receipts) && row.receipts.length) ? millis(row.publicationAttempts) : null,
    receipts: adminReceipts(row.receipts),
  };
}

function isRuleDoc(ref: FirebaseFirestore.DocumentReference) {
  return ref.parent.path === 'auto_content_rules';
}
function isPublishDoc(doc: QueryDocumentSnapshot) {
  return doc.ref.parent.parent?.parent.path === 'workspaces';
}

type LoadedRule = { summary: AdminRule; pending: ReturnType<typeof pendingInfo> };
function pendingInfo(row: Data) {
  return {
    id: row.enabled === true && typeof row.pendingJob === 'string' ? row.pendingJob : null,
    due: millis(row.nextDueMs),
    reconciling: typeof row.pendingReconciliation === 'string' ? row.pendingReconciliation : null,
  };
}

const ruleFields = ['workspaceId','businessId','enabled','revision','processingJob','nextSlotMs','lastError','pendingJob','nextDueMs','pendingReconciliation'];

async function ruleRows(db: Firestore, refs: FirebaseFirestore.DocumentReference[]) {
  const unique = [...new Map(refs.filter(isRuleDoc).map(ref => [ref.path, ref])).values()];
  if (!unique.length) return new Map<string, LoadedRule>();
  const rules = (await db.getAll(...unique, { fieldMask: ruleFields })).filter(doc => {
    const workspace = workspaceIdSchema.safeParse(doc.get('workspaceId'));
    const business = businessKey.safeParse(doc.get('businessId'));
    return doc.exists && workspace.success && business.success && doc.id === ruleKey(workspace.data, business.data);
  });
  const lookups = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const doc of rules) {
    const workspace = db.collection('workspaces').doc(doc.get('workspaceId'));
    lookups.set(workspace.path, workspace);
    if (doc.get('businessId') !== 'primary') {
      const business = workspace.collection('business_contexts').doc(doc.get('businessId'));
      lookups.set(business.path, business);
    }
  }
  const docs = lookups.size ? await db.getAll(...lookups.values(), { fieldMask: ['name', 'brand.businessName'] }) : [];
  const names = new Map(docs.filter(doc => doc.exists).map(doc => [doc.ref.path, plain(doc.get(doc.ref.parent.id === 'workspaces' ? 'name' : 'brand.businessName'))]));
  return new Map(rules.map(doc => {
    const workspaceId = doc.get('workspaceId') as string;
    const businessId = doc.get('businessId') as string;
    const workspaceName = names.get('workspaces/' + workspaceId) || workspaceId;
    const businessName = businessId === 'primary' ? workspaceName : names.get('workspaces/' + workspaceId + '/business_contexts/' + businessId) || businessId;
    return [doc.ref.path, { summary: toRule(doc.data()!, workspaceId, businessId, workspaceName, businessName), pending: pendingInfo(doc.data()!) }] as const;
  }));
}

function collectJobs(docs: QueryDocumentSnapshot[], rules: Map<string, LoadedRule>) {
  return docs.flatMap(doc => {
    const rule = rules.get(doc.ref.parent.parent?.path || '');
    return rule ? [toJob(doc, rule.summary, rule.pending)] : [];
  });
}
const fields = ['state','scheduledAt','retryAt','format','generationAttempts','publicationAttempts','receipts','draftId'];
const dueRules = (db: Firestore) => db.collection('auto_content_rules').where('enabled', '==', true).orderBy('nextDueMs');
const blockedRules = (db: Firestore) => db.collection('auto_content_rules').where('lastError', '>', '').select().limit(RULE_LIMIT);
const priority = (state: string) => ['needs_attention', 'reconciling'].includes(state) ? 0 : state === 'failed' ? 1 : state === 'skipped' ? 2 : 3;
const fallbackRootLimit = 25;
const fallbackJobLimit = 50;

async function readWithIndexFallback<T>(indexed: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await indexed(); }
  catch (error) {
    const { code, message } = error as { code?: number | string; message?: string };
    if (![3, 9, 'INVALID_ARGUMENT', 'FAILED_PRECONDITION'].includes(code ?? '') ||
        !/requires (?:an?|the) [^\n]*index|index (?:is )?(?:currently )?building/i.test(message ?? '')) throw error;
    return fallback();
  }
}

async function readAdminPublications(db: Firestore, start: number) {
  const timestamps = ['completedAt', 'lastConfirmedAt'];
  const withinDay = (root: Query, field: string, limit: number) =>
    root.where(field, '>=', start).where(field, '<', start + DAY).select('receipts').limit(limit + 1).get();
  const rows = (docs: QueryDocumentSnapshot[]) => docs.filter(isPublishDoc)
    .map(doc => ({ path: doc.ref.path, receipts: doc.get('receipts') }));
  return readWithIndexFallback(async () => {
    const pages = await Promise.all(timestamps.map(field => withinDay(db.collectionGroup('publish_jobs'), field, PUBLISH_WINDOW_LIMIT)));
    return {
      publications: pages.flatMap(page => rows(page.docs.slice(0, PUBLISH_WINDOW_LIMIT))),
      partial: pages.some(page => page.size > PUBLISH_WINDOW_LIMIT),
    };
  }, async () => {
    const roots = await db.collection('workspaces').select().limit(fallbackRootLimit + 1).get();
    const pages = await Promise.all(roots.docs.slice(0, fallbackRootLimit).flatMap(workspace =>
      timestamps.map(field => withinDay(workspace.ref.collection('publish_jobs'), field, fallbackRootLimit))));
    return {
      publications: pages.flatMap(page => rows(page.docs.slice(0, fallbackRootLimit))),
      partial: roots.size > fallbackRootLimit || pages.some(page => page.size > fallbackRootLimit),
    };
  });
}

async function readScopedAutonomy(db: Firestore) {
  const roots = await db.collection('auto_content_rules').select('enabled', 'nextSlotMs').limit(fallbackRootLimit + 1).get();
  const ruleDocs = roots.docs.slice(0, fallbackRootLimit);
  const pages = await Promise.all(ruleDocs.map(rule =>
    rule.ref.collection('jobs').orderBy('createdAt', 'desc').select('createdAt', ...fields).limit(fallbackJobLimit + 1).get()));
  const jobs = pages.flatMap(page => page.docs.slice(0, fallbackJobLimit))
    .sort((a, b) => (millis(b.get('createdAt')) ?? 0) - (millis(a.get('createdAt')) ?? 0));
  return { jobs, ruleDocs, partial: roots.size > fallbackRootLimit || pages.some(page => page.size > fallbackJobLimit) };
}

function isAttention(job: QueryDocumentSnapshot, now: number) {
  return ATTENTION_STATES.some(state => state === job.get('state')) && (millis(job.get('createdAt')) ?? 0) >= now - 7 * DAY;
}

function isRecovering(job: QueryDocumentSnapshot) {
  return RECOVERY_STATES.some(state => state === job.get('state'));
}

async function readOverviewActivity(db: Firestore, now: number) {
  const jobs = db.collectionGroup('jobs');
  const incident = (states: readonly string[]) => jobs.where('state', 'in', states).where('createdAt', '>=', now - 7 * DAY).orderBy('createdAt', 'desc');
  const recovery = jobs.where('state', 'in', RECOVERY_STATES);
  return readWithIndexFallback(async () => {
    const [attention, recovering, urgent, queue, next] = await Promise.all([
      incident(ATTENTION_STATES).count().get(), recovery.count().get(),
      Promise.all(ATTENTION_STATES.map(state => incident([state]).select(...fields).limit(8).get())),
      recovery.orderBy('createdAt','desc').select(...fields).limit(6).get(),
      db.collection('auto_content_rules').where('enabled','==',true).where('nextSlotMs','>=',now).orderBy('nextSlotMs').select().limit(6).get(),
    ]);
    return { attention: attention.data().count, recovering: recovering.data().count,
      jobDocs: [...urgent.flatMap(page => page.docs), ...queue.docs], next: next.docs, partial: false };
  }, async () => {
    const { jobs, ruleDocs, partial } = await readScopedAutonomy(db);
    const attention = jobs.filter(job => isAttention(job, now));
    const recovering = jobs.filter(isRecovering);
    const urgent = ATTENTION_STATES.flatMap(state => attention.filter(job => job.get('state') === state).slice(0, 8));
    const next = ruleDocs.filter(rule => rule.get('enabled') === true && (millis(rule.get('nextSlotMs')) ?? 0) >= now)
      .sort((a, b) => a.get('nextSlotMs') - b.get('nextSlotMs')).slice(0, 6);
    return { attention: attention.length, recovering: recovering.length, jobDocs: [...urgent, ...recovering.slice(0, 6)], next, partial };
  });
}

async function overview(db: Firestore, health: typeof schedulerHealth): Promise<AdminOverview> {
  const now = Date.now();
  const start = Date.parse(wibDay(new Date(now)) + 'T00:00:00+07:00');
  const [workspaces, publications, activity, blocks, scheduler] = await Promise.all([
    db.collection('workspaces').where('onboardingCompleted', '==', true).count().get(),
    readAdminPublications(db, start), readOverviewActivity(db, now), blockedRules(db).get(), health(),
  ]);
  const jobDocs = activity.jobDocs.filter(doc => doc.ref.parent.parent && isRuleDoc(doc.ref.parent.parent));
  const rules = await ruleRows(db, [...jobDocs.map(doc => doc.ref.parent.parent!), ...blocks.docs.map(doc => doc.ref), ...activity.next.map(doc => doc.ref)]);
  const actions = collectJobs(jobDocs, rules).sort((a,b) => priority(a.state) - priority(b.state)).slice(0, 10);
  return {
    activeWorkspaces: workspaces.data().count, publishedToday: countConfirmedToday(publications.publications, start),
    publishedLowerBound: publications.partial, activityPartial: activity.partial,
    attention: activity.attention, recovering: activity.recovering, scheduler, actions,
    blocked: blocks.docs.flatMap(doc => { const row = rules.get(doc.ref.path)?.summary; return row?.issue ? [row] : []; }),
    upcoming: activity.next.flatMap(doc => { const row = rules.get(doc.ref.path)?.summary; return row?.enabled && row.nextSlot && row.nextSlot >= now ? [row] : []; }).sort((a,b) => a.nextSlot! - b.nextSlot!).slice(0, 6),
  };
}

async function listWorkspaces(db: Firestore, params: URLSearchParams): Promise<AdminWorkspacePage> {
  const term = z.string().trim().max(110).parse(params.get('q') || '');
  const cursor = params.get('cursor');
  if (cursor && cursor.length > 8192) throw new ApiError(400, 'Halaman tidak valid.');
  const after = cursor ? pageCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString())) : null;
  const root = db.collection('workspaces');
  let query: Query = term ? root.orderBy('name').orderBy(FieldPath.documentId()).startAt(term).endAt(term + '\uf8ff') : root.orderBy(FieldPath.documentId());
  if (after && (term ? !after[0].startsWith(term) : after[0] !== '')) throw new ApiError(400, 'Halaman tidak valid.');
  if (after) query = term ? query.startAfter(...after) : query.startAfter(after[1]);
  const view = (query: Query) => query.select('name','subscriptionPlanId','onboardingCompleted');
  const [page, exact] = await Promise.all([
    view(query).limit(WORKSPACE_PAGE + 1).get(),
    term && !after && workspaceIdSchema.safeParse(term).success
      ? view(root.where(FieldPath.documentId(), '==', term)).limit(1).get() : null,
  ]);
  const visible = page.docs.slice(0, WORKSPACE_PAGE);
  const last = visible.at(-1);
  return {
    items: [...new Map([...(exact?.docs || []), ...visible].map(doc => [doc.id, workspaceSummary(doc.id, doc.data())])).values()],
    cursor: page.size > WORKSPACE_PAGE && last ? Buffer.from(JSON.stringify([term ? last.get('name') : '', last.id])).toString('base64url') : null,
  };
}

async function workspaceDetail(db: Firestore, workspaceId: string): Promise<AdminWorkspaceDetail> {
  const ref = db.collection('workspaces').doc(workspaceId);
  const raw = (await ref.get()).data();
  if (!raw) throw new ApiError(404, 'Workspace tidak ditemukan.');
  const plan = planId(raw.subscriptionPlanId);
  const auditQuery = db.collection('platform_admin_audit').where('workspaceId', '==', workspaceId);
  const [publication, generation, docs, profile, audit] = await Promise.all([
    readPublicationQuota(ref, plan),
    generationQuotaStatus(ref, workspaceId, plan),
    ref.collection('private_meta_connections').select('channel','accountId','accountName','handle','expiresAt').get(),
    raw.snapshotJson ? loadBusinessContexts(ref, raw).then(contexts => ({ status: 'ready' as const, contexts })).catch(error => {
      if (!(error instanceof ApiError) || error.code !== 'business_context_invalid') throw error;
      return { status: 'unavailable' as const, contexts: [] };
    }) : { status: 'missing' as const, contexts: [] },
    readWithIndexFallback(async () => (await auditQuery.orderBy('at', 'desc').limit(20).get()).docs,
      async () => (await auditQuery.limit(100).get()).docs.sort((a, b) => Number(b.get('at')) - Number(a.get('at'))).slice(0, 20)),
  ]);
  const { status: profileStatus, contexts } = profile;
  const accounts = readSocialAccounts(docs.docs).map(row => ({
    id: row.connectionId, channel: row.channel, label: plain(row.handle) ? '@' + plain(row.handle).replace(/^@/, '') : plain(row.accountName, row.channel),
    ready: !row.expiresAt || row.expiresAt > Date.now(),
  }));
  const refs = contexts.map(context => db.collection('auto_content_rules').doc(ruleKey(ref.id, context.id)));
  const ruleDocs = refs.length ? await db.getAll(...refs, { fieldMask: ruleFields }) : [];
  const workspace = workspaceSummary(ref.id, raw);
  const entries = contexts.map((context, index) => {
    const record = ruleDocs[index]?.data();
    const name = plain(context.brand.businessName, context.id);
    const rule = record && record.workspaceId === ref.id && record.businessId === context.id ? toRule(record, ref.id, context.id, workspace.name, name) : null;
    return { id: context.id, name, accounts: accounts.filter(account => context.connectionIds.includes(account.id)), rule };
  });
  const history = await Promise.all(entries.map(async (entry,index) => {
    if (!entry.rule) return [];
    const query = refs[index].collection('jobs').orderBy('createdAt','desc').select(...fields).limit(12);
    return (await query.get()).docs.map(doc => toJob(doc, entry.rule!, pendingInfo(ruleDocs[index].data()!)));
  }));
  return {
    workspace, profileStatus, generation, businesses: entries, publication,
    unassigned: profileStatus === 'unavailable' ? [] : accounts.filter(account => !entries.some(entry => entry.accounts.some(item => item.id === account.id))),
    jobs: history.flat().sort((a,b) => (b.scheduledAt || 0) - (a.scheduledAt || 0)).slice(0, 24),
    pauseAudit: audit.flatMap((doc): AdminPauseAudit[] => {
      const row = doc.data();
      const at = millis(row.at);
      if (row.action !== 'autonomy.pause' || !at) return [];
      return [{ id: doc.id, actor: plain(row.actorEmail) || plain(row.actorUid), reason: typeof row.reason === 'string' ? row.reason.slice(0, 240) : '',
        at, businessName: plain(row.businessName) || entries.find(entry => entry.id === row.businessId)?.name || plain(row.businessId),
        processing: row.processing === true }];
    }),
  };
}

async function operations(db: Firestore, health: typeof schedulerHealth, params: URLSearchParams): Promise<AdminOperations> {
  const state = z.enum(['all', 'attention', 'recovery']).parse(params.get('state') || 'all');
  const now = Date.now();
  let query: Query = db.collectionGroup('jobs');
  if (state !== 'all') query = query.where('state','in',state === 'attention' ? ATTENTION_STATES : RECOVERY_STATES);
  if (state === 'attention') query = query.where('createdAt','>=',now - 7 * DAY);
  const [jobs, active, blocks, scheduler] = await Promise.all([
    readWithIndexFallback(async () => ({
      docs: (await query.orderBy('createdAt','desc').select(...fields).limit(40).get()).docs,
      partial: false,
    }), async () => {
      const scoped = await readScopedAutonomy(db);
      const selected = state === 'attention' ? scoped.jobs.filter(job => isAttention(job, now))
        : state === 'recovery' ? scoped.jobs.filter(isRecovering) : scoped.jobs;
      return { docs: selected.slice(0, 40), partial: scoped.partial };
    }),
    dueRules(db).select().limit(RULE_LIMIT + 1).get(), blockedRules(db).get(), health(),
  ]);
  const rules = await ruleRows(db, [...jobs.docs.flatMap(doc => doc.ref.parent.parent ? [doc.ref.parent.parent] : []), ...active.docs.map(doc => doc.ref), ...blocks.docs.map(doc => doc.ref)]);
  const pick = (docs: QueryDocumentSnapshot[]) => docs.flatMap(doc => { const row = rules.get(doc.ref.path)?.summary; return row ? [row] : []; });
  return { scheduler, jobs: collectJobs(jobs.docs,rules), blocked: pick(blocks.docs), rules: pick(active.docs.slice(0,RULE_LIMIT)), ruleLimitReached: active.size > RULE_LIMIT, activityPartial: jobs.partial };
}

export async function getAdminOperations(request: Request, deps: { authorize?: typeof requireUser; database?: Firestore; health?: typeof schedulerHealth } = {}) {
  await requirePlatformOperator(request, deps.authorize);
  const params = new URL(request.url).searchParams;
  const view = z.enum(['overview','workspaces','workspace','operations']).parse(params.get('view') || 'overview');
  const db = deps.database || adminDb();
  switch (view) {
    case 'workspaces': return listWorkspaces(db, params);
    case 'workspace': return workspaceDetail(db, workspaceIdSchema.parse(params.get('workspaceId')));
    case 'operations': return operations(db, deps.health || schedulerHealth, params);
    default: return overview(db, deps.health || schedulerHealth);
  }
}

export async function pauseAdminRule(request: Request, deps: { authorize?: typeof requireUser; database?: Firestore; now?: () => number } = {}) {
  const user = await requirePlatformOperator(request, deps.authorize);
  const input = pauseInput.parse(await readJson(request, 4096));
  const db = deps.database || adminDb();
  const workspaceRef = db.collection('workspaces').doc(input.workspaceId);
  const ruleRef = db.collection('auto_content_rules').doc(ruleKey(input.workspaceId, input.businessId));
  const auditRef = db.collection('platform_admin_audit').doc();
  return db.runTransaction(async tx => {
    const [workspace, rule] = await Promise.all([tx.get(workspaceRef), tx.get(ruleRef)]);
    const row = rule.data();
    if (!workspace.exists || !row || row.workspaceId !== workspaceRef.id || row.businessId !== input.businessId) throw new ApiError(404, 'Aturan Otonom tidak ditemukan.');
    if (row.ownerUid !== workspace.get('ownerUid') || !row.ownerUid || row.revision !== input.expectedRevision || row.enabled !== true) {
      throw new ApiError(409, 'Aturan telah berubah. Muat ulang sebelum melanjutkan.', 'autonomy_conflict');
    }
    const pendingId = workspaceIdSchema.safeParse(row.pendingJob);
    const pending = pendingId.success && pendingId.data !== row.processingJob && pendingId.data !== row.pendingReconciliation
      ? ruleRef.collection('jobs').doc(pendingId.data) : null;
    const queued = pending ? await tx.get(pending) : null;
    const now = (deps.now || Date.now)();
    if (queued?.exists && queued.get('ruleRevision') === row.revision && RECOVERY_STATES.some(state => state === queued.get('state'))) {
      tx.update(queued.ref, { state: 'cancelled', retryAt: null, finishedAt: now, error: 'Aturan dijeda oleh Super Admin.' });
    }
    const revision = row.revision + 1;
    tx.update(ruleRef, { enabled: false, pendingJob: null, revision, updatedAt: now });
    tx.create(auditRef, { action: 'autonomy.pause', actorUid: user.uid, actorEmail: user.email || null, workspaceId: input.workspaceId, businessId: input.businessId,
      reason: input.reason, at: now, before: { enabled: true, revision: row.revision }, after: { enabled: false, revision }, processing: !!row.processingJob });
    return { revision, processing: !!row.processingJob };
  });
}
