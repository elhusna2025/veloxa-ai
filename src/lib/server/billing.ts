import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { PAID_ACCESS_DAYS, type AdminBillingDetail, type AdminBillingList, type BillingInvoice, type BillingWorkspace, type WorkspaceBilling } from '../billing';
import { effectiveWorkspacePlan, storedWorkspacePlan } from '../subscription';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import type { SubscriptionPlanId } from '../veloxa-types';
import { adminQuotaRefs, resolveAdminQuota } from './admin-settings';
import { requirePlatformOperator, requireUser, requireWorkspace, workspaceIdSchema } from './auth';
import { wibMonth } from './clock';
import { checkDuitkuInvoice, createDuitkuInvoice, duitkuConfig, duitkuPaymentUrl, merchantOrderIdSchema, parseDuitkuCallback, type DuitkuConfig } from './duitku';
import { adminDb } from './firebase';
import { generationQuotaStatus } from './generation-policy';
import { ApiError, readJson } from './http';
import { readPublicationQuota } from './publication-quota';

const expiryMinutes = 60;
const pageSize = 25;
const paidPlanSchema = z.enum(['starter_500k', 'growth_1000k', 'pro_1500k']);
const invoiceSchema = z.object({
  workspaceId: workspaceIdSchema, ownerUid: z.string().min(1),
  planId: paidPlanSchema, mode: z.enum(['production', 'sandbox']),
  amountIdr: z.number().int().positive().safe(),
  state: z.enum(['creating', 'pending', 'paid', 'cancelled', 'needs_review']),
  createdAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  reference: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  paymentUrl: z.string().optional(), paidAt: z.number().int().positive().optional(),
  paidUntil: z.number().int().positive().optional(), lastCheckedAt: z.number().int().positive().optional(),
});
type InvoiceRecord = z.infer<typeof invoiceSchema>;
type Dependencies = {
  database?: Firestore;
  authorize?: typeof requireUser;
  authorizeWorkspace?: typeof requireWorkspace;
  fetcher?: typeof fetch;
  now?: () => number;
  config?: DuitkuConfig | null;
};
const runtimeConfig = (deps: Dependencies) => deps.config === undefined ? duitkuConfig() : deps.config;
const invoiceDocs = (ref: DocumentReference) => ref.collection('private_billing_invoices');
const checkoutRef = (ref: DocumentReference, mode: DuitkuConfig['mode']) => ref.collection('private_billing_state').doc(`checkout_${mode}`);
const monthlyPayments = (ref: DocumentReference, at: number) => ref.collection('private_billing_monthly').doc(wibMonth(new Date(at)));

function billable(deps: Dependencies) {
  const config = runtimeConfig(deps);
  if (!config) throw new ApiError(501, 'Pembayaran Duitku belum tersedia.', 'billing_pending');
  return config;
}

export function billingWorkspace(id: string, workspace: Record<string, unknown>, now: number): BillingWorkspace {
  const planId = effectiveWorkspacePlan(workspace, now);
  const paidUntil = Number.isSafeInteger(workspace.subscriptionPaidUntilMs) && Number(workspace.subscriptionPaidUntilMs) > 0 ? Number(workspace.subscriptionPaidUntilMs) : null;
  const state = storedWorkspacePlan(workspace) === 'free_trial' ? 'trial'
    : planId === 'free_trial' ? 'expired' : paidUntil ? 'active' : 'legacy';
  const name = typeof workspace.name === 'string' && workspace.name.trim() ? workspace.name.trim().slice(0, 120) : id;
  return { id, name, planId, state, paidUntil };
}

function projectInvoice(id: string, invoice: InvoiceRecord, config: DuitkuConfig | null, now: number, includePaymentLink: boolean): BillingInvoice {
  const sameMode = invoice.mode === config?.mode;
  const paymentUrl = includePaymentLink && sameMode && invoice.state === 'pending' && now < invoice.expiresAt && invoice.reference
    ? duitkuPaymentUrl(invoice.paymentUrl, invoice.mode, invoice.reference) : null;
  return {
    id, planId: invoice.planId, amountIdr: invoice.amountIdr, mode: invoice.mode, state: invoice.state,
    createdAt: invoice.createdAt, expiresAt: invoice.expiresAt, paidAt: invoice.paidAt ?? null,
    paidUntil: invoice.paidUntil ?? null, paymentUrl,
    canCheck: sameMode && !invoice.paidAt && ['creating', 'pending'].includes(invoice.state),
  };
}

async function workspaceBilling(ref: DocumentReference, workspace: Record<string, unknown>, actorUid: string | null, deps: Dependencies): Promise<WorkspaceBilling> {
  const now = (deps.now || Date.now)();
  const workspaceInfo = billingWorkspace(ref.id, workspace, now);
  const config = runtimeConfig(deps);
  const canPay = !!config && !!actorUid && actorUid === workspace.ownerUid;
  const policy = adminQuotaRefs(ref.firestore, ref.id, workspaceInfo.planId);
  const [publication, generation, invoices, checkout, globalPolicy, workspacePolicy] = await Promise.all([
    readPublicationQuota(ref, workspaceInfo.planId, undefined, new Date(now)),
    generationQuotaStatus(ref, ref.id, workspaceInfo.planId),
    invoiceDocs(ref).orderBy('createdAt', 'desc').limit(20).get(),
    config ? checkoutRef(ref, config.mode).get() : null, policy.plan.get(), policy.workspace.get(),
  ]);
  return {
    workspace: workspaceInfo, mode: config?.mode ?? 'disabled', canPay, publication, generation,
    checkoutPending: checkout?.exists === true,
    invoices: invoices.docs.flatMap(doc => {
      const invoice = invoiceSchema.safeParse(doc.data());
      return invoice.success && invoice.data.workspaceId === ref.id ? [projectInvoice(doc.id, invoice.data, canPay || !actorUid ? config : null, now, canPay)] : [];
    }),
    plans: (Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlanId[]).map(id => ({
      id, publicationLimit: resolveAdminQuota(id, globalPolicy.data(), workspacePolicy.data()).monthlyPublicationLimit ?? SUBSCRIPTION_PLANS[id].monthlyPostQuota,
    })),
  };
}

export async function readWorkspaceBilling(request: Request, deps: Dependencies = {}) {
  const workspaceId = new URL(request.url).searchParams.get('workspaceId');
  const { ref, user, workspace } = await (deps.authorizeWorkspace || requireWorkspace)(request, workspaceId);
  return workspaceBilling(ref, workspace, user.uid, deps);
}

export async function readAdminBilling(request: Request, deps: Dependencies = {}): Promise<AdminBillingDetail | AdminBillingList> {
  await requirePlatformOperator(request, deps.authorize);
  const query = new URL(request.url).searchParams;
  const db = deps.database || adminDb();
  const collection = db.collection('workspaces');
  const now = (deps.now || Date.now)();
  if (!query.has('workspaceId')) {
    const cursor = query.has('cursor') ? workspaceIdSchema.parse(query.get('cursor')) : null;
    const ordered = collection.orderBy(FieldPath.documentId());
    const page = await (cursor ? ordered.startAfter(cursor) : ordered)
      .select('name', 'subscriptionPlanId', 'subscriptionPaidUntilMs').limit(pageSize + 1).get();
    const docs = page.docs.slice(0, pageSize);
    return { mode: runtimeConfig(deps)?.mode ?? 'disabled', workspaces: docs.map(doc => billingWorkspace(doc.id, doc.data(), now)),
      nextCursor: page.size > pageSize ? docs.at(-1)!.id : null };
  }
  const ref = collection.doc(workspaceIdSchema.parse(query.get('workspaceId')));
  const workspace = (await ref.get()).data();
  if (!workspace) throw new ApiError(404, 'Workspace tidak ditemukan.');
  const month = wibMonth(new Date(now));
  const start = Date.parse(`${month}-01T00:00:00+07:00`);
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.getTime() - 7 * 60 * 60 * 1000;
  const [data, drafts, payments, review] = await Promise.all([
    workspaceBilling(ref, workspace, null, deps),
    ref.collection('social_drafts').where('createdAt', '>=', start).where('createdAt', '<', end).count().get(),
    monthlyPayments(ref, now).get(),
    invoiceDocs(ref).where('state', '==', 'needs_review').count().get(),
  ]);
  const savedDrafts = drafts.data().count;
  return { ...data, costs: { month, savedDrafts, estimatedAiIdr: savedDrafts * SUBSCRIPTION_PLANS[data.workspace.planId].estimatedApiCostPerPostIdr,
    paidIdr: payments.get('paidIdr') ?? 0, reviewInvoices: review.data().count } };
}

const invoiceRequestSchema = z.object({ workspaceId: workspaceIdSchema, planId: paidPlanSchema }).strict();
const invoiceCheckSchema = z.object({ workspaceId: workspaceIdSchema, invoiceId: merchantOrderIdSchema }).strict();

export async function beginWorkspaceInvoice(request: Request, deps: Dependencies = {}) {
  const input = invoiceRequestSchema.parse(await readJson(request, 4096));
  const { ref, user } = await (deps.authorizeWorkspace || requireWorkspace)(request, input.workspaceId, true);
  const config = billable(deps);
  const email = z.email().max(255).safeParse(user.email);
  if (user.email_verified !== true || !email.success) throw new ApiError(403, 'Verifikasi email akun sebelum membuat tagihan.');
  const db = ref.firestore;
  const checkout = checkoutRef(ref, config.mode);
  const id = `vlx_${randomUUID().replaceAll('-', '')}`;
  const invoiceRef = invoiceDocs(ref).doc(id);
  const now = (deps.now || Date.now)();
  const plan = SUBSCRIPTION_PLANS[input.planId];
  const invoice = { workspaceId: ref.id, ownerUid: user.uid, planId: input.planId, mode: config.mode,
    amountIdr: plan.priceMonthlyIdr, state: 'creating', createdAt: now, expiresAt: now + expiryMinutes * 60_000 } as const;
  await db.runTransaction(async tx => {
    const [workspace, existing] = await tx.getAll(ref, checkout);
    if (workspace.get('ownerUid') !== user.uid) throw new ApiError(403, 'Hanya pemilik workspace dapat membuat tagihan.');
    const current = billingWorkspace(ref.id, workspace.data()!, now);
    if (config.mode === 'production' && (current.state === 'legacy' || current.state === 'active' && current.planId !== input.planId)) {
      throw new ApiError(409, 'Tunggu hingga masa aktif paket berakhir untuk mengganti paket.');
    }
    if (existing.exists) throw new ApiError(409, 'Ada tagihan yang menunggu. Periksa tagihan tersebut sebelum membuat yang baru.', 'checkout_in_progress');
    tx.create(invoiceRef, invoice);
    tx.create(db.collection('private_billing_order_index').doc(id), { workspaceId: ref.id });
    tx.create(checkout, { invoiceId: id });
  });

  // A lost response does not prove that Duitku failed to create the invoice.
  const created = await createDuitkuInvoice(config, { id, amountIdr: invoice.amountIdr, planName: plan.name, email: email.data, now, expiryMinutes }, deps.fetcher);
  await db.runTransaction(async tx => {
    const stored = invoiceSchema.parse((await tx.get(invoiceRef)).data());
    if (stored.reference && stored.reference !== created.reference) throw new ApiError(409, 'Referensi tagihan perlu diperiksa.');
    if (stored.state === 'creating') tx.update(invoiceRef, { ...created, state: 'pending' });
  });
  const stored = invoiceSchema.parse((await invoiceRef.get()).data());
  return { invoice: projectInvoice(id, stored, config, now, true) };
}

async function reconcileInvoice(ref: DocumentReference, id: string, config: DuitkuConfig, deps: Dependencies, callback?: { amount: number; reference: string }, ownerUid?: string) {
  const invoiceRef = invoiceDocs(ref).doc(id);
  const checkout = checkoutRef(ref, config.mode);
  const db = ref.firestore;
  const now = (deps.now || Date.now)();
  const candidate = invoiceSchema.safeParse((await invoiceRef.get()).data());
  if (!candidate.success || candidate.data.workspaceId !== ref.id) throw new ApiError(404, 'Tagihan tidak ditemukan.');
  const invoice = candidate.data;
  if (invoice.mode !== config.mode) throw new ApiError(409, 'Lingkungan pembayaran tagihan berbeda.');
  if (callback && (invoice.amountIdr !== callback.amount || invoice.reference && invoice.reference !== callback.reference)) {
    throw new ApiError(409, 'Rincian pembayaran tidak sesuai tagihan.');
  }
  if (invoice.paidAt) return invoice;
  if (!callback) {
    await db.runTransaction(async tx => {
      const [owner, existing] = await tx.getAll(ref, invoiceRef);
      if (ownerUid && owner.get('ownerUid') !== ownerUid) throw new ApiError(403, 'Hanya pemilik workspace dapat memeriksa tagihan.');
      const previous = existing.get('lastCheckedAt');
      if (typeof previous === 'number' && now - previous < 30_000) throw new ApiError(429, 'Tunggu 30 detik sebelum memeriksa tagihan lagi.');
      tx.update(invoiceRef, { lastCheckedAt: now });
    });
  }
  const provider = await checkDuitkuInvoice(config, id, deps.fetcher);
  if (provider.amount !== invoice.amountIdr || invoice.reference && invoice.reference !== provider.reference || callback && callback.reference !== provider.reference) {
    throw new ApiError(409, 'Rincian pembayaran tidak sesuai tagihan.');
  }
  if (callback && provider.statusCode === '01') {
    throw new ApiError(503, 'Duitku masih memproses pembayaran. Periksa tagihan kembali.', 'payment_confirmation_pending');
  }
  return db.runTransaction(async tx => {
    const [stored, workspaceDoc, lock] = await tx.getAll(invoiceRef, ref, checkout);
    const current = invoiceSchema.parse(stored.data());
    if (current.reference && current.reference !== provider.reference) throw new ApiError(409, 'Referensi pembayaran berubah.');
    if (current.paidAt || current.state === 'cancelled' && provider.statusCode !== '00') return current;
    if (provider.statusCode !== '00') {
      const state = provider.statusCode === '02' ? 'cancelled' : 'pending';
      const update = { state, reference: provider.reference, paymentUrl: duitkuPaymentUrl(
        `https://${config.mode === 'production' ? 'app-prod' : 'app-sandbox'}.duitku.com/redirect_checkout?reference=${encodeURIComponent(provider.reference)}`,
        config.mode, provider.reference,
      ) ?? undefined } as const;
      tx.update(invoiceRef, { state, reference: update.reference, ...(update.paymentUrl && { paymentUrl: update.paymentUrl }) });
      if (state === 'cancelled' && lock.get('invoiceId') === id) tx.delete(checkout);
      return { ...current, ...update };
    }
    const workspace = workspaceDoc.data();
    const activePlan = workspace && billingWorkspace(ref.id, workspace, now);
    const canApply = config.mode === 'production' && workspace?.ownerUid === current.ownerUid && activePlan &&
      (activePlan.state === 'trial' || activePlan.state === 'expired' || activePlan.state === 'active' && activePlan.planId === current.planId);
    const paidUntil = canApply ? Math.max(now, activePlan.paidUntil ?? now) + PAID_ACCESS_DAYS * 86_400_000 : null;
    const state = config.mode === 'production' && !canApply ? 'needs_review' : 'paid';
    const update = { state, reference: provider.reference, paidAt: now, ...(paidUntil && { paidUntil }) } as const;
    if (paidUntil) tx.update(ref, { subscriptionPlanId: current.planId, subscriptionPaidUntilMs: paidUntil, quotaLimit: SUBSCRIPTION_PLANS[current.planId].monthlyPostQuota });
    tx.update(invoiceRef, update);
    if (config.mode === 'production') tx.set(monthlyPayments(ref, now), { paidIdr: FieldValue.increment(current.amountIdr) }, { merge: true });
    if (lock.get('invoiceId') === id && state !== 'needs_review') tx.delete(checkout);
    return { ...current, ...update };
  });
}

export async function checkWorkspaceInvoice(request: Request, deps: Dependencies = {}) {
  const input = invoiceCheckSchema.parse(await readJson(request, 4096));
  const { ref, workspace, user } = await (deps.authorizeWorkspace || requireWorkspace)(request, input.workspaceId, true);
  if (workspace.ownerUid !== user.uid) throw new ApiError(403, 'Hanya pemilik workspace dapat memeriksa tagihan.');
  const config = billable(deps);
  const invoice = await reconcileInvoice(ref, input.invoiceId, config, deps, undefined, user.uid);
  return { invoice: projectInvoice(input.invoiceId, invoice, config, (deps.now || Date.now)(), true) };
}

export async function checkAdminInvoice(request: Request, deps: Dependencies = {}) {
  await requirePlatformOperator(request, deps.authorize);
  const input = invoiceCheckSchema.parse(await readJson(request, 4096));
  const config = billable(deps);
  const ref = (deps.database || adminDb()).collection('workspaces').doc(input.workspaceId);
  const invoice = await reconcileInvoice(ref, input.invoiceId, config, deps);
  return { invoice: projectInvoice(input.invoiceId, invoice, config, (deps.now || Date.now)(), false) };
}

export async function confirmDuitkuPayment(request: Request, deps: Dependencies = {}) {
  const config = billable(deps);
  const event = await parseDuitkuCallback(request, config);
  const db = deps.database || adminDb();
  const order = await db.collection('private_billing_order_index').doc(event.id).get();
  const workspaceId = workspaceIdSchema.safeParse(order.get('workspaceId'));
  if (!workspaceId.success) throw new ApiError(404, 'Tagihan tidak ditemukan.');
  const ref = db.collection('workspaces').doc(workspaceId.data);
  await reconcileInvoice(ref, event.id, config, deps, event);
  return { ok: true };
}
