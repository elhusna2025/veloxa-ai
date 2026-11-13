import { isDeepStrictEqual } from 'node:util';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  DEFAULT_CONTENT_MODELS, type AdminModelKey, type AdminModelOverrides, type AdminPlanSettings,
  type AdminQuotaOverrides, type AdminSettingsAudit, type AdminSettingsView,
} from '../admin-settings';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { effectiveWorkspacePlan } from '../subscription';
import type { SubscriptionPlanId } from '../veloxa-types';
import { requirePlatformOperator, requireUser, workspaceIdSchema } from './auth';
import { adminDb } from './firebase';
import { ApiError, readJson } from './http';

const modelName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const modelsSchema = z.object({
  scriptModel: modelName.optional(), imageModel: modelName.optional(), voiceModel: modelName.optional(),
}).strict();
const dayLimit = z.number().int().min(0).max(10_000);
const monthLimit = z.number().int().min(0).max(1_000_000);
const workspaceQuotaSchema = z.object({
  dailyDraftLimit: dayLimit.nullable().optional(),
  dailyPublicationLimit: dayLimit.optional(),
  monthlyPublicationLimit: monthLimit.optional(),
}).strict();
const planIdSchema = z.enum(['free_trial', 'starter_500k', 'growth_1000k', 'pro_1500k']);
const planQuotaSchema = z.object({ dailyDraftLimit: dayLimit, dailyPublicationLimit: dayLimit.nullable(), monthlyPublicationLimit: monthLimit }).strict();
const planSchema = planQuotaSchema.extend({ id: planIdSchema });
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const changeSchema = z.object({
  workspaceId: workspaceIdSchema.optional(),
  expectedRevision: revisionSchema,
  reason: z.string().trim().min(5).max(240),
  models: modelsSchema.optional(),
  quota: workspaceQuotaSchema.optional(),
  plans: z.array(planSchema).min(1).max(4).optional(),
  restoreRevision: revisionSchema.optional(),
}).strict().refine(value => {
  const edit = value.models !== undefined || value.quota !== undefined || value.plans !== undefined;
  return (value.restoreRevision === undefined ? edit : !edit) &&
    !(value.workspaceId && value.plans) && !(!value.workspaceId && value.quota) &&
    (!value.plans || new Set(value.plans.map(plan => plan.id)).size === value.plans.length);
});

type PlanQuota = z.infer<typeof planQuotaSchema>;
type SettingsState = { models: AdminModelOverrides; quota: AdminQuotaOverrides; plans: Partial<Record<SubscriptionPlanId, PlanQuota>> };
type Data = Record<string, unknown>;
type Dependencies = { authorize?: typeof requireUser; database?: Firestore; now?: () => number };
const planIds = planIdSchema.options;
const modelKeys = Object.keys(DEFAULT_CONTENT_MODELS) as AdminModelKey[];

function settingsRef(db: Firestore, workspaceId?: string) {
  return db.collection('private_admin_settings').doc(workspaceId ? `workspace_${workspaceId}` : 'global');
}

export function adminQuotaRefs(db: Firestore, workspaceId: string, _planId: SubscriptionPlanId) {
  return { plan: settingsRef(db), workspace: settingsRef(db, workspaceId) };
}

function parseModels(value: unknown): AdminModelOverrides {
  const parsed = modelsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function parseWorkspaceQuota(value: unknown): AdminQuotaOverrides {
  const parsed = workspaceQuotaSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function parsePlanQuota(plans: unknown, id: SubscriptionPlanId) {
  if (!plans || typeof plans !== 'object' || !Object.hasOwn(plans, id)) return undefined;
  const parsed = planQuotaSchema.safeParse((plans as Data)[id]);
  return parsed.success ? parsed.data : undefined;
}

export function resolveAdminQuota(id: SubscriptionPlanId, planData?: Data, workspaceData?: Data): AdminQuotaOverrides {
  const plan = parsePlanQuota(planData?.plans, id);
  return {
    ...(plan && { dailyDraftLimit: plan.dailyDraftLimit, monthlyPublicationLimit: plan.monthlyPublicationLimit }),
    ...(plan?.dailyPublicationLimit != null && { dailyPublicationLimit: plan.dailyPublicationLimit }),
    ...parseWorkspaceQuota(workspaceData?.quota),
  };
}

export async function resolveAdminModels(db: Firestore, workspaceId: string): Promise<AdminModelOverrides> {
  const [global, workspace] = await Promise.all([settingsRef(db).get(), settingsRef(db, workspaceId).get()]);
  const allowed = availableModels();
  return { ...activeModels(global.data()?.models, allowed), ...activeModels(workspace.data()?.models, allowed) };
}

function configuredModels(value: string | undefined, fallback: string) {
  return [...new Set([fallback, ...(value?.split(',').map(model => model.trim()).filter(model => modelName.safeParse(model).success) ?? [])])];
}

function availableModels(): AdminSettingsView['availableModels'] {
  return {
    scriptModel: configuredModels(process.env.VELOXA_ADMIN_SCRIPT_MODELS, DEFAULT_CONTENT_MODELS.scriptModel)
      .filter(model => model === DEFAULT_CONTENT_MODELS.scriptModel || model === 'gpt-6.1-sol'),
    imageModel: configuredModels(process.env.VELOXA_ADMIN_IMAGE_MODELS, DEFAULT_CONTENT_MODELS.imageModel),
    voiceModel: configuredModels(process.env.VELOXA_ADMIN_VOICE_MODELS, DEFAULT_CONTENT_MODELS.voiceModel),
  };
}

function activeModels(value: unknown, allowed: ReturnType<typeof availableModels>): AdminModelOverrides {
  const stored = parseModels(value);
  const active: AdminModelOverrides = {};
  for (const key of modelKeys) {
    const model = stored[key];
    if (model && allowed[key].includes(model)) active[key] = model;
  }
  return active;
}

function readState(data?: Data): SettingsState {
  const plans: SettingsState['plans'] = {};
  for (const id of planIds) {
    const plan = parsePlanQuota(data?.plans, id);
    if (plan) plans[id] = plan;
  }
  return { models: parseModels(data?.models), quota: parseWorkspaceQuota(data?.quota), plans };
}

function planSettings(id: SubscriptionPlanId, stored?: PlanQuota): AdminPlanSettings {
  const plan = SUBSCRIPTION_PLANS[id];
  return {
    id, label: plan.name,
    dailyDraftLimit: stored?.dailyDraftLimit ?? plan.maxPostsPerDay * 3,
    dailyPublicationLimit: stored?.dailyPublicationLimit ?? null,
    monthlyPublicationLimit: stored?.monthlyPublicationLimit ?? plan.monthlyPostQuota,
  };
}

const readRevision = (value: unknown) => revisionSchema.safeParse(value).data ?? 0;

function describeChanges(before: SettingsState, after: SettingsState, workspace: boolean): string[] {
  const changes: string[] = [];
  const modelLabels = { scriptModel: 'Naskah', imageModel: 'Gambar', voiceModel: 'Narasi suara' };
  const quotaLabels = { dailyDraftLimit: 'Draf harian', dailyPublicationLimit: 'Publikasi harian', monthlyPublicationLimit: 'Publikasi bulanan' };
  const format = (value: number | null | undefined) => value === undefined ? 'Ikuti paket' : value === null ? 'Tanpa batas' : String(value);
  const inherited = workspace ? 'Ikuti platform' : 'Bawaan';
  for (const key of modelKeys) {
    if (before.models[key] !== after.models[key]) changes.push(`${modelLabels[key]} · ${before.models[key] ?? inherited} → ${after.models[key] ?? inherited}`);
  }
  type QuotaValues = Partial<Record<keyof PlanQuota, number | null>>;
  const quotaChanges = (oldQuota: QuotaValues, newQuota: QuotaValues, prefix = '') => {
    for (const key of Object.keys(quotaLabels) as (keyof PlanQuota)[]) {
      if (oldQuota[key] !== newQuota[key]) changes.push(`${prefix}${quotaLabels[key]} · ${format(oldQuota[key])} → ${format(newQuota[key])}`);
    }
  };
  if (workspace) quotaChanges(before.quota, after.quota);
  else {
    for (const id of planIds) quotaChanges(planSettings(id, before.plans[id]), planSettings(id, after.plans[id]), SUBSCRIPTION_PLANS[id].name + ' · ');
  }
  return changes;
}

export async function getAdminSettings(request: Request, deps: Dependencies = {}): Promise<AdminSettingsView> {
  await requirePlatformOperator(request, deps.authorize);
  const params = new URL(request.url).searchParams;
  const workspaceId = params.has('workspaceId') ? workspaceIdSchema.parse(params.get('workspaceId')) : undefined;
  const db = deps.database || adminDb();
  const ref = settingsRef(db, workspaceId);
  const [doc, global, workspace, legacy] = await Promise.all([
    ref.get(),
    workspaceId ? settingsRef(db).get() : null,
    workspaceId ? db.collection('workspaces').doc(workspaceId).get() : null,
    workspaceId ? db.collection('platform_configs').doc(`generation_${workspaceId}`).get() : null,
  ]);
  if (workspace && !workspace.exists) throw new ApiError(404, 'Workspace tidak ditemukan.');
  const revision = readRevision(doc.get('revision'));
  const state = readState(doc.data());
  const history = revision ? await ref.collection('revisions').orderBy('revision', 'desc').startAt(revision).limit(30).get() : null;
  const audit = (history?.docs ?? []).map((item): AdminSettingsAudit => {
    const row = item.data();
    return { id: item.id, actor: row.actor, reason: row.reason, action: row.action, at: row.at, revision: row.revision,
      ...(Array.isArray(row.changes) && { changes: row.changes.filter((change): change is string => typeof change === 'string').slice(0, 15) }),
      ...(typeof row.restoredFrom === 'number' && { restoredFrom: row.restoredFrom }) };
  });
  const allowed = availableModels();
  const defaultModels = { ...DEFAULT_CONTENT_MODELS, ...activeModels(global?.get('models'), allowed) };
  const common = { revision, models: state.models, audit, availableModels: allowed, defaultModels,
    effectiveModels: { ...defaultModels, ...activeModels(state.models, allowed) } };
  if (!workspaceId) return { ...common, scope: 'global', plans: planIds.map(id => planSettings(id, state.plans[id])) };
  const planId = effectiveWorkspacePlan(workspace?.data() ?? {});
  const plan = planSettings(planId, parsePlanQuota(global?.get('plans'), planId));
  const legacyUnlimited = legacy?.get('workspaceId') === workspaceId && legacy?.get('mode') === 'development' && legacy?.get('enabled') === true;
  const name: unknown = workspace?.get('name');
  return {
    ...common, scope: 'workspace', workspaceId, workspaceName: typeof name === 'string' && name.trim() ? name : workspaceId,
    quota: state.quota,
    effectiveQuota: {
      dailyDraftLimit: state.quota.dailyDraftLimit !== undefined ? state.quota.dailyDraftLimit : legacyUnlimited ? null : plan.dailyDraftLimit,
      monthlyPublicationLimit: state.quota.monthlyPublicationLimit ?? plan.monthlyPublicationLimit,
      dailyPublicationLimit: state.quota.dailyPublicationLimit ?? plan.dailyPublicationLimit,
    },
  };
}

export async function updateAdminSettings(request: Request, deps: Dependencies = {}) {
  const actor = await requirePlatformOperator(request, deps.authorize);
  const input = changeSchema.parse(await readJson(request, 8192));
  const db = deps.database || adminDb();
  const ref = settingsRef(db, input.workspaceId);
  const allowed = availableModels();
  const now = (deps.now || Date.now)();
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (input.workspaceId && !(await tx.get(db.collection('workspaces').doc(input.workspaceId))).exists) {
      throw new ApiError(404, 'Workspace tidak ditemukan.');
    }
    const previousRevision = readRevision(doc.get('revision'));
    if (input.expectedRevision !== previousRevision) throw new ApiError(409, 'Pengaturan sudah berubah. Muat ulang sebelum menyimpan.', 'settings_conflict');
    const before = readState(doc.data());
    let next = { ...before, models: input.models ?? before.models, quota: input.quota ?? before.quota };
    if (input.plans) {
      next.plans = { ...before.plans };
      for (const { id, ...quota } of input.plans) next.plans[id] = quota;
    }
    const restore = input.restoreRevision !== undefined;
    if (restore) {
      const from = input.restoreRevision!;
      if (from >= previousRevision) throw new ApiError(400, 'Pilih revisi sebelumnya.');
      const snapshot = from ? await tx.get(ref.collection('revisions').doc(String(from))) : null;
      if (snapshot && !snapshot.exists) throw new ApiError(404, 'Revisi pengaturan tidak ditemukan.');
      next = readState(snapshot?.get('settings'));
    }
    for (const key of modelKeys) {
      const model = next.models[key];
      if (model !== undefined && model !== before.models[key] && !allowed[key].includes(model)) {
        throw new ApiError(400, 'Model ' + model + ' belum tersedia pada server Veloxa.', 'model_unavailable');
      }
    }
    if (isDeepStrictEqual(before, next)) return { revision: previousRevision };
    const revision = previousRevision + 1;
    tx.set(ref, { ...next, revision, updatedAt: now });
    tx.create(ref.collection('revisions').doc(String(revision)), {
      revision, action: restore ? 'restore' : 'update', actor: actor.email || actor.uid, actorUid: actor.uid,
      reason: input.reason, at: now, settings: next, changes: describeChanges(before, next, Boolean(input.workspaceId)),
      ...(restore && { restoredFrom: input.restoreRevision }),
    });
    return { revision };
  });
}
