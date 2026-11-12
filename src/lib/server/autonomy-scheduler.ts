import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { workspaceIdSchema } from './auth';
import { dispatchGuard } from './autonomy-dispatch';

type Database = FirebaseFirestore.Firestore;
type Rule = FirebaseFirestore.QueryDocumentSnapshot;
type SlotResult = { state: string; draftId?: string; error?: string };
type ScanCursor = { dueAt: number; id: string };

// A tick has one shared 300-second request. Start all selected work in one batch.
const TICK_LEASE_MS = 7 * 60_000;
const SLOT_START_BUDGET_MS = 25_000;
const QUERY_PAGE_SIZE = 24;
const MAX_RULES_SCANNED = 96;
const WORK_BUDGET = 6;

function slotCost(rule: FirebaseFirestore.DocumentData): number {
  // An expired claim runs recovery bookkeeping in this tick, without generating new media.
  if (rule.processingJob) return 1;
  const formats = rule.config?.formats;
  if (!Array.isArray(formats) || !formats.length || !Number.isSafeInteger(rule.sequence)) return 3;
  // A retry uses the preceding slot's format. Charge its full cost even if a draft already exists.
  const sequence = rule.pendingJob ? Math.max(0, rule.sequence - 1) : rule.sequence;
  const format = formats[sequence % formats.length];
  return format === 'single_post' ? 1 : format === 'carousel' ? 2 : 3;
}

async function selectDueRules(db: Database, dueAt: number, after: ScanCursor | null, mayStart: () => boolean) {
  // Firestore adds the ascending document-ID tie breaker to the existing composite index.
  const due = db.collection('auto_content_rules').where('enabled', '==', true)
    .where('nextDueMs', '<=', dueAt).orderBy('nextDueMs', 'asc').orderBy(FieldPath.documentId(), 'asc');
  const rules: Rule[] = [];
  const guardByWorkspace = new Map<string, boolean>();
  const eligibleWorkspaces = new Set<string>();
  let cursor: Rule | undefined;
  let remaining = WORK_BUDGET;
  let scanned = 0;
  let blocked = 0;
  const queueHead = after && mayStart() ? (await due.limit(1).get()).docs[0]?.get('nextDueMs') : undefined;
  let oldestDueAt: number | null = typeof queueHead === 'number' ? queueHead : null;

  while (remaining > 0 && scanned < MAX_RULES_SCANNED && mayStart()) {
    const query = cursor ? due.startAfter(cursor) : after ? due.startAfter(after.dueAt, after.id) : due;
    const { docs } = await query.limit(QUERY_PAGE_SIZE).get();
    if (!docs.length) break;
    scanned += docs.length;
    cursor = docs[docs.length - 1];
    if (oldestDueAt === null) {
      const firstDueAt = docs[0].get('nextDueMs');
      if (typeof firstDueAt === 'number') oldestDueAt = firstDueAt;
    }

    const candidates = docs.flatMap(rule => {
      const data = rule.data();
      const id = workspaceIdSchema.safeParse(data.workspaceId);
      if (!id.success || eligibleWorkspaces.has(id.data) ||
          (data.processingJob && data.processingUntil > dueAt)) return [];
      return [{ rule, data, workspaceId: id.data }];
    });
    const unknownWorkspaces = [...new Set(candidates.map(candidate => candidate.workspaceId))]
      .filter(id => !guardByWorkspace.has(id));
    if (unknownWorkspaces.length) {
      const guards = await db.getAll(...unknownWorkspaces.map(id => dispatchGuard(db.collection('workspaces').doc(id))));
      for (const guard of guards) guardByWorkspace.set(guard.ref.parent.parent!.id, Boolean(guard.get('leaseId')));
    }

    for (const { rule, data, workspaceId } of candidates) {
      if (eligibleWorkspaces.has(workspaceId)) continue;
      // A stranded dispatch is reconciled separately. It should not disable other businesses in the workspace.
      if (!data.processingJob && guardByWorkspace.get(workspaceId)) {
        blocked += 1;
        continue;
      }
      eligibleWorkspaces.add(workspaceId);
      const cost = slotCost(data);
      if (cost > remaining) continue;
      rules.push(rule);
      remaining -= cost;
      if (!remaining) break;
    }
    if (docs.length < QUERY_PAGE_SIZE) break;
  }
  const scanLimitReached = scanned >= MAX_RULES_SCANNED;
  const cursorDueAt = cursor?.get('nextDueMs');
  // Rotate past a full scan that yielded no eligible workspace, then restart at the oldest.
  const nextCursor = !rules.length && scanLimitReached && cursor && typeof cursorDueAt === 'number'
    ? { dueAt: cursorDueAt, id: cursor.id } : null;
  return { rules, scanned, blocked, oldestDueAt, scanLimitReached, nextCursor };
}

interface SchedulerDependencies {
  db: Database;
  process: (ref: FirebaseFirestore.DocumentReference) => Promise<SlotResult>;
  reconcile: (db: Database, now: number) => Promise<number>;
  now?: () => number;
}

export async function runAutonomySchedulerTick({ db, process, reconcile, now = Date.now }: SchedulerDependencies) {
  const heartbeat = db.collection('system_operations').doc('organic_scheduler');
  const leaseId = randomUUID();
  const startedAt = now();
  const acquired = await db.runTransaction(async tx => {
    const existing = (await tx.get(heartbeat)).data();
    if (typeof existing?.tickLeaseUntil === 'number' && existing.tickLeaseUntil > now()) return null;
    const saved = existing?.scanAfter;
    const after = Number.isFinite(saved?.dueAt) && typeof saved?.id === 'string' && /^[^/]+$/.test(saved.id)
      ? { dueAt: saved.dueAt as number, id: saved.id } : null;
    tx.set(heartbeat, { at: startedAt, tickLeaseId: leaseId, tickLeaseUntil: now() + TICK_LEASE_MS }, { merge: true });
    return { after };
  });
  if (!acquired) return { state: 'busy', processed: 0, reconciled: 0 };

  let completed = false;
  let reconciled = 0;
  let reconciliationFailed = false;
  let stats: Record<string, unknown> = {};
  let scanAfter = acquired.after;
  try {
    try {
      reconciled = await reconcile(db, startedAt);
    } catch {
      reconciliationFailed = true;
    }

    const mayStart = () => now() - startedAt < SLOT_START_BUDGET_MS;
    const selectionAt = now();
    const batch = await selectDueRules(db, selectionAt, scanAfter, mayStart);
    const startBudgetExceeded = !mayStart();
    const selected = startBudgetExceeded ? [] : batch.rules;
    const results = await Promise.allSettled(selected.map(async rule => process(rule.ref)));
    const outcomes: Record<string, number> = {};
    for (const result of results) {
      const state = result.status === 'fulfilled' ? result.value.state : 'worker_error';
      outcomes[state] = (outcomes[state] ?? 0) + 1;
    }
    stats = {
      processed: results.length,
      scannedDue: batch.scanned,
      unselectedDueSample: batch.scanned - results.length,
      blockedByDispatch: batch.blocked,
      oldestDueLagMs: batch.oldestDueAt === null ? 0 : Math.max(0, selectionAt - batch.oldestDueAt),
      scanLimitReached: batch.scanLimitReached,
      startBudgetExceeded,
      outcomes,
      reconciled,
      reconciliationFailed,
    };
    completed = !startBudgetExceeded;
    if (completed) scanAfter = batch.nextCursor;
    const onlyResult = results.length === 1 ? results[0] : undefined;
    if (onlyResult?.status === 'fulfilled') return { ...onlyResult.value, processed: 1, reconciled };
    const state = startBudgetExceeded ? 'deferred' : !results.length ? 'idle'
      : outcomes.worker_error === results.length ? 'worker_error' : 'batch';
    return { state, processed: results.length, reconciled };
  } finally {
    const finishedAt = now();
    const metrics = { ...stats, elapsedMs: finishedAt - startedAt };
    await db.runTransaction(async tx => {
      const existing = (await tx.get(heartbeat)).data();
      if (existing?.tickLeaseId !== leaseId) return;
      tx.update(heartbeat, {
        tickLeaseId: null,
        tickLeaseUntil: 0,
        ...(completed ? { completedAt: finishedAt } : { lastErrorAt: finishedAt }),
        scanAfter,
        lastBatch: metrics,
      });
    });
    if (!completed || reconciliationFailed || stats.scannedDue || reconciled) {
      const entry = JSON.stringify({ event: 'organic_scheduler_tick', completed, ...metrics });
      if (!completed || reconciliationFailed) console.warn(entry);
      else console.info(entry);
    }
  }
}
