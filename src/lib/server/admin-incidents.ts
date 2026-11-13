import { createHash } from 'node:crypto';
import type { DocumentReference, DocumentSnapshot, Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { AdminIncident, AdminIncidents, AdminIncidentSource, AdminIncidentUpdate } from '../admin-incidents';
import { ATTENTION_STATES } from '../admin-operations';
import { adminReceipts, readWithIndexFallback, ruleIssue } from './admin-operations';
import { ruleKey, schedulerHeartbeat } from './autonomy-api';
import { requirePlatformOperator, requireUser, workspaceIdSchema } from './auth';
import { adminDb } from './firebase';
import { ApiError, readJson } from './http';

const collection = 'platform_admin_autonomy_incidents';
const limit = 30;
const historyLimit = 8;
const sevenDays = 7 * 86_400_000;
const stamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const scopeSchema = z.object({ workspaceId: workspaceIdSchema, businessId: z.string().regex(/^(primary|b_[a-f0-9-]{36})$/) });
const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scheduler'), lastCompletedAt: stamp.nullable() }),
  scopeSchema.extend({ kind: z.literal('rule'), revision }).strict(),
  scopeSchema.extend({ kind: z.literal('process'), jobId: workspaceIdSchema, deadline: stamp }).strict(),
  scopeSchema.extend({ kind: z.literal('slot'), jobId: workspaceIdSchema }).strict(),
]);
const status = z.enum(['open', 'investigating', 'resolved']);
const inputSchema = z.strictObject({ source: sourceSchema, expectedRevision: revision, status, note: z.string().trim().min(5).max(240) });
const historySchema = z.object({ actor: z.string().max(512), at: stamp, status, note: z.string().max(240) });
const storedSchema = z.object({
  source: sourceSchema, title: z.string().max(150), guidance: z.string().max(300), priority: z.enum(['urgent', 'warning']),
  workspaceName: z.string().max(512).nullable(), businessName: z.string().max(512).nullable(), at: stamp.nullable(),
  status, revision, history: z.array(historySchema).max(historyLimit),
});
const ruleFields = ['workspaceId', 'businessId', 'ownerUid', 'enabled', 'lastError', 'updatedAt', 'revision', 'processingJob', 'processingUntil', 'pendingReconciliation'];
const slotFields = ['state', 'createdAt', 'scheduledAt', 'error', 'receipts'];
type Options = { database?: Firestore; authorize?: typeof requireUser; now?: () => number; schedulerConfigured?: boolean };
type Data = Record<string, unknown>;
type Scope = z.infer<typeof scopeSchema>;
type Details = Omit<AdminIncident, 'status' | 'revision' | 'history' | 'detected'>;
type Names = Pick<Details, 'workspaceName' | 'businessName'>;

function idFor(source: AdminIncidentSource) {
  const identity = source.kind === 'scheduler' ? [source.kind, source.lastCompletedAt]
    : [source.kind, source.workspaceId, source.businessId, source.kind === 'rule' ? source.revision : source.jobId, source.kind === 'process' ? source.deadline : null];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

const millis = (value: unknown) => stamp.safeParse(value).data ?? null;
const name = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 150) : fallback;
const schedulerRef = (db: Firestore) => db.collection('system_operations').doc('organic_scheduler');
const workspaceRef = (db: Firestore, scope: Scope) => db.collection('workspaces').doc(scope.workspaceId);
const businessRef = (db: Firestore, scope: Scope) => workspaceRef(db, scope).collection('business_contexts').doc(scope.businessId);

function scopeFor(rule: DocumentSnapshot) {
  const parsed = scopeSchema.safeParse({ workspaceId: rule.get('workspaceId'), businessId: rule.get('businessId') });
  return parsed.success && rule.id === ruleKey(parsed.data.workspaceId, parsed.data.businessId) ? parsed.data : null;
}

function namesFor(scope: Scope, workspace: DocumentSnapshot | undefined, business: DocumentSnapshot | undefined): Names {
  const workspaceName = name(workspace?.get('name'), scope.workspaceId);
  return { workspaceName, businessName: scope.businessId === 'primary' ? workspaceName : name(business?.get('brand.businessName'), scope.businessId) };
}

function schedulerIncident(data: Data | undefined, now: number, configured?: boolean): Details | null {
  const heartbeat = schedulerHeartbeat(data, now, configured);
  if (heartbeat.schedulerReady) return null;
  const at = millis(heartbeat.lastCompletedAt);
  const source: AdminIncidentSource = { kind: 'scheduler', lastCompletedAt: at };
  return { id: idFor(source), source, at, priority: 'urgent', workspaceName: null, businessName: null,
    title: heartbeat.configured ? 'Penjadwal belum menyelesaikan pemeriksaan' : 'Penjadwal belum terhubung',
    guidance: 'Periksa konfigurasi dan log penjadwal. Cocokkan hasil akun tujuan sebelum memproses slot yang tertunda.' };
}

function ruleIncidents(scope: Scope, names: Names, row: Data, now: number): Details[] {
  const incidents: Details[] = [];
  const deadline = millis(row.processingUntil);
  const job = workspaceIdSchema.safeParse(row.processingJob);
  if (job.success && deadline && deadline <= now) {
    const source: AdminIncidentSource = { kind: 'process', ...scope, jobId: job.data, deadline };
    incidents.push({ id: idFor(source), source, ...names, at: deadline, priority: 'urgent', title: 'Proses slot melewati batas waktu',
      guidance: 'Periksa aktivitas slot dan hasil di akun tujuan. Tunggu pemulihan jika Veloxa masih mengonfirmasi hasil.' });
  }
  const issue = ruleIssue(row.lastError);
  const currentRevision = revision.safeParse(row.revision);
  if (issue && currentRevision.success && row.enabled === false && !row.pendingReconciliation && !job.success) {
    const source: AdminIncidentSource = { kind: 'rule', ...scope, revision: currentRevision.data };
    incidents.push({ id: idFor(source), source, ...names, at: millis(row.updatedAt), priority: 'warning', title: 'Aturan Otonom terhenti', guidance: issue });
  }
  return incidents;
}

function slotIncident(scope: Scope, names: Names, rule: Data, job: DocumentSnapshot, now: number): Details | null {
  const state = job.get('state');
  const created = millis(job.get('createdAt'));
  if (!created || created < now - sevenDays || !ATTENTION_STATES.some(value => value === state) ||
      rule.pendingReconciliation === job.id || rule.processingJob === job.id || !workspaceIdSchema.safeParse(job.id).success) return null;
  const source: AdminIncidentSource = { kind: 'slot', ...scope, jobId: job.id };
  const quota = state === 'skipped' && /kuota/i.test(String(job.get('error') || ''));
  return { id: idFor(source), source, ...names, at: millis(job.get('scheduledAt')) ?? created, priority: state === 'needs_attention' ? 'urgent' : 'warning',
    receipts: adminReceipts(job.get('receipts')),
    title: state === 'needs_attention' ? 'Hasil slot perlu diperiksa' : state === 'failed' ? 'Slot Otonom gagal' : quota ? 'Slot melewati batas kuota' : 'Slot Otonom terlewat',
    guidance: state === 'needs_attention' ? 'Cocokkan aktivitas slot dengan kiriman yang terlihat di akun tujuan sebelum mengirim apa pun.'
      : quota ? 'Periksa kuota draf atau publikasi pada Detail Workspace.' : 'Buka aktivitas slot dan periksa draf serta hasil per akun.' };
}

async function readSlots(db: Firestore, now: number) {
  return readWithIndexFallback(async () => {
    const results = await db.collectionGroup('jobs').where('state', 'in', ATTENTION_STATES).where('createdAt', '>=', now - sevenDays)
      .orderBy('createdAt', 'desc').select(...slotFields).limit(limit + 1).get();
    return { docs: results.docs.slice(0, limit), partial: results.size > limit };
  }, async () => {
    const roots = await db.collection('auto_content_rules').select().limit(26).get();
    const groups = await Promise.all(roots.docs.slice(0, 25).map(rule => rule.ref.collection('jobs')
      .where('createdAt', '>=', now - sevenDays).orderBy('createdAt', 'desc').select(...slotFields).limit(51).get()));
    const docs = groups.flatMap(group => group.docs.slice(0, 50)).filter(doc => ATTENTION_STATES.some(state => state === doc.get('state')))
      .sort((a, b) => Number(b.get('createdAt')) - Number(a.get('createdAt')));
    return { docs: docs.slice(0, limit), partial: roots.size > 25 || groups.some(group => group.size > 50) || docs.length > limit };
  });
}

function storedIncident(doc: DocumentSnapshot): AdminIncident | null {
  const parsed = storedSchema.safeParse(doc.data());
  return parsed.success && doc.id === idFor(parsed.data.source) ? { ...parsed.data, id: doc.id, detected: false } : null;
}

export async function getAdminIncidents(request: Request, options: Options = {}): Promise<AdminIncidents> {
  await requirePlatformOperator(request, options.authorize);
  const db = options.database || adminDb();
  const now = (options.now || Date.now)();
  const rules = db.collection('auto_content_rules');
  const incidents = db.collection(collection);
  const [heartbeat, blocked, overdue, slots, current, resolved] = await Promise.all([
    schedulerRef(db).get(), rules.where('lastError', '>', '').select().limit(limit + 1).get(),
    rules.where('processingUntil', '>', 0).where('processingUntil', '<=', now).select().limit(limit + 1).get(),
    readSlots(db, now), incidents.where('activeUpdatedAt', '>', 0).orderBy('activeUpdatedAt', 'desc').limit(limit + 1).get(),
    incidents.where('resolvedAt', '>', 0).orderBy('resolvedAt', 'desc').limit(limit + 1).get(),
  ]);
  const slotDocs = slots.docs.filter(doc => doc.ref.parent.parent?.parent.path === rules.path);
  const ruleRefs = [...blocked.docs.slice(0, limit).map(doc => doc.ref), ...overdue.docs.slice(0, limit).map(doc => doc.ref),
    ...slotDocs.map(doc => doc.ref.parent.parent!)];
  const uniqueRefs = [...new Map(ruleRefs.map(ref => [ref.path, ref])).values()];
  const ruleDocs = uniqueRefs.length ? await db.getAll(...uniqueRefs, { fieldMask: ruleFields }) : [];
  const validRules = ruleDocs.flatMap(doc => {
    const scope = scopeFor(doc);
    return scope ? [{ doc, scope }] : [];
  });
  const nameRefs = validRules.flatMap(({ scope }) => scope.businessId === 'primary' ? [workspaceRef(db, scope)] : [workspaceRef(db, scope), businessRef(db, scope)]);
  const uniqueNames = [...new Map(nameRefs.map(ref => [ref.path, ref])).values()];
  const nameDocs = uniqueNames.length ? await db.getAll(...uniqueNames, { fieldMask: ['name', 'ownerUid', 'brand.businessName'] }) : [];
  const nameMap = new Map(nameDocs.map(doc => [doc.ref.path, doc]));
  const ruleMap = new Map(validRules.flatMap(({ doc, scope }) => {
    const workspace = nameMap.get(workspaceRef(db, scope).path);
    if (!workspace?.exists || !doc.get('ownerUid') || doc.get('ownerUid') !== workspace.get('ownerUid')) return [];
    return [[doc.ref.path, { scope, row: doc.data()!, names: namesFor(scope, workspace, nameMap.get(businessRef(db, scope).path)) }] as const];
  }));
  const detected = new Map<string, Details>();
  const add = (item: Details | null) => { if (item) detected.set(item.id, item); };
  add(schedulerIncident(heartbeat.data(), now, options.schedulerConfigured));
  for (const { scope, row, names } of ruleMap.values()) ruleIncidents(scope, names, row, now).forEach(add);
  const failedSlots = new Map<string, Details[]>();
  for (const slot of slotDocs) {
    const rulePath = slot.ref.parent.parent!.path;
    const rule = ruleMap.get(rulePath);
    const incident = rule && slotIncident(rule.scope, rule.names, rule.row, slot, now);
    if (!incident) continue;
    add(incident);
    if (slot.get('state') === 'failed') {
      const related = failedSlots.get(rulePath) ?? [];
      related.push(incident);
      failedSlots.set(rulePath, related);
    }
  }
  for (const related of failedSlots.values()) {
    if (related.length < 2) continue;
    for (const incident of related) add({ ...incident, failedSlots: related.length });
  }
  const records = new Map<string, AdminIncident>();
  const addRecord = (doc: DocumentSnapshot) => {
    const row = storedIncident(doc);
    if (row) records.set(row.id, row);
  };
  [...current.docs.slice(0, limit), ...resolved.docs.slice(0, limit)].forEach(addRecord);
  const missing = [...detected.keys()].filter(id => !records.has(id)).map(id => incidents.doc(id));
  if (missing.length) (await db.getAll(...missing)).forEach(addRecord);
  for (const item of detected.values()) {
    const existing = records.get(item.id);
    records.set(item.id, { ...item, detected: true, status: existing?.status ?? 'open', revision: existing?.revision ?? 0, history: existing?.history ?? [] });
  }
  return { incidents: [...records.values()].sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') ||
    (b.history[0]?.at ?? b.at ?? 0) - (a.history[0]?.at ?? a.at ?? 0)),
    partial: slots.partial || [blocked, overdue, current, resolved].some(snapshot => snapshot.size > limit) };
}

async function confirmSource(db: Firestore, tx: Transaction, source: AdminIncidentSource, now: number, configured?: boolean): Promise<Details | null> {
  const id = idFor(source);
  if (source.kind === 'scheduler') {
    const incident = schedulerIncident((await tx.get(schedulerRef(db))).data(), now, configured);
    return incident?.id === id ? incident : null;
  }
  const ruleRef = db.collection('auto_content_rules').doc(ruleKey(source.workspaceId, source.businessId));
  const workspace = workspaceRef(db, source);
  const business = source.businessId === 'primary' ? null : businessRef(db, source);
  const slot = source.kind === 'slot' ? ruleRef.collection('jobs').doc(source.jobId) : null;
  const refs: DocumentReference[] = [ruleRef, workspace];
  if (business) refs.push(business);
  if (slot) refs.push(slot);
  const docs = new Map((await tx.getAll(...refs)).map(doc => [doc.ref.path, doc]));
  const rule = docs.get(ruleRef.path);
  const workspaceDoc = docs.get(workspace.path);
  const data = rule?.data();
  if (!rule || !workspaceDoc?.exists || !data || !scopeFor(rule) || !data.ownerUid || data.ownerUid !== workspaceDoc.get('ownerUid')) return null;
  const scope = { workspaceId: source.workspaceId, businessId: source.businessId };
  const names = namesFor(scope, workspaceDoc, business ? docs.get(business.path) : undefined);
  if (slot) return slotIncident(scope, names, data, docs.get(slot.path)!, now);
  return ruleIncidents(scope, names, data, now).find(incident => incident.id === id) ?? null;
}

export async function updateAdminIncident(request: Request, options: Options = {}) {
  const user = await requirePlatformOperator(request, options.authorize);
  const input = inputSchema.parse(await readJson(request, 4096));
  const db = options.database || adminDb();
  const id = idFor(input.source);
  const ref = db.collection(collection).doc(id);
  const audit = db.collection('platform_admin_audit').doc();
  const now = (options.now || Date.now)();
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const current = storedIncident(snapshot);
    const previous = current?.status ?? 'open';
    const version = current?.revision ?? 0;
    if ((snapshot.exists && !current) || version !== input.expectedRevision) {
      throw new ApiError(409, 'Penanganan insiden berubah. Muat ulang sebelum menyimpan.', 'incident_conflict');
    }
    if (input.status === previous || (previous === 'resolved' && input.status !== 'open')) {
      throw new ApiError(409, 'Pilih perubahan status yang tersedia.', 'incident_conflict');
    }
    const details = current ?? await confirmSource(db, tx, input.source, now, options.schedulerConfigured);
    if (!details) throw new ApiError(409, 'Kondisi insiden berubah. Muat ulang untuk memeriksa hasil terbaru.', 'incident_source_changed');
    const entry: AdminIncidentUpdate = { actor: (user.email || user.uid).slice(0, 512), at: now, status: input.status, note: input.note };
    const after = { status: input.status, revision: version + 1 };
    const history = [entry, ...(current?.history ?? [])].slice(0, historyLimit);
    tx.set(ref, {
      source: input.source, title: details.title, guidance: details.guidance, priority: details.priority,
      workspaceName: details.workspaceName, businessName: details.businessName, at: details.at, ...after,
      history,
      activeUpdatedAt: input.status === 'resolved' ? null : now, resolvedAt: input.status === 'resolved' ? now : null,
    });
    tx.create(audit, {
      action: 'autonomy.incident.update', actorUid: user.uid, actorEmail: user.email || null, incidentId: id,
      workspaceId: input.source.kind === 'scheduler' ? null : input.source.workspaceId,
      businessId: input.source.kind === 'scheduler' ? null : input.source.businessId,
      reason: input.note, at: now, before: { status: previous, revision: version }, after,
    });
    return { ...after, history };
  });
}
