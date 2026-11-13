import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { PAID_ACCESS_DAYS } from '../billing';
import { effectiveWorkspacePlan } from '../subscription';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { beginWorkspaceInvoice, billingWorkspace, checkWorkspaceInvoice, confirmDuitkuPayment, readAdminBilling, readWorkspaceBilling } from './billing';
import { checkDuitkuInvoice, createDuitkuInvoice, duitkuConfig, parseDuitkuCallback, type DuitkuConfig } from './duitku';
import { ApiError } from './http';

const now = Date.parse('2026-11-14T10:00:00+07:00');
const sandbox = { mode: 'sandbox', merchantCode: 'TEST1', key: 'fixture-key', origin: 'https://billing.example.test' } satisfies DuitkuConfig;
const production = { ...sandbox, mode: 'production' } satisfies DuitkuConfig;
const fixtureId = 'vlx_0123456789abcdef0123456789abcdef';
const providerReference = 'DUITKU_TEST_REFERENCE';
const workspaceId = 'billing_test_workspace';
const price = SUBSCRIPTION_PLANS.starter_500k.priceMonthlyIdr;
const url = 'https://billing.example.test/api/veloxa/billing/';
const day = 86_400_000;
const accessMs = PAID_ACCESS_DAYS * day;
const owner = { uid: 'billing_owner', email: 'owner@example.test', email_verified: true } as DecodedIdToken;
const status = (value: number) => (error: unknown) => error instanceof ApiError && error.status === value;
const hmac = (value: string) => createHmac('sha256', sandbox.key).update(value).digest('hex');
const json = (data: unknown) => Response.json(data);

function callback(id: string, overrides: Record<string, string> = {}) {
  const amount = String(price);
  return new Request(url + 'webhook/', { method: 'POST', body: new URLSearchParams({
    merchantCode: sandbox.merchantCode, merchantOrderId: id, reference: providerReference, amount, resultCode: '00',
    signature: hmac(sandbox.merchantCode + amount + id), ...overrides,
  }) });
}

test('expiry falls back to free quota without removing paid plan history; legacy grants persist', () => {
  const paid = { subscriptionPlanId: 'starter_500k', subscriptionPaidUntilMs: now + day };
  assert.equal(effectiveWorkspacePlan(paid, now), 'starter_500k');
  assert.equal(effectiveWorkspacePlan(paid, now + day), 'free_trial');
  assert.deepEqual(billingWorkspace(workspaceId, paid, now + day), { id: workspaceId, name: workspaceId,
    planId: 'free_trial', state: 'expired', paidUntil: now + day });
  assert.equal(effectiveWorkspacePlan({ subscriptionPlanId: 'growth_1000k' }, now), 'growth_1000k');
  assert.equal(billingWorkspace(workspaceId, { subscriptionPlanId: 'growth_1000k' }, now).state, 'legacy');
  assert.equal(effectiveWorkspacePlan({ subscriptionPlanId: 'growth_1000k', subscriptionPaidUntilMs: 'forever' }, now), 'free_trial');
  assert.equal(effectiveWorkspacePlan({ subscriptionPlanId: '__proto__' }, now), 'free_trial');
});

test('Duitku uses the documented signed checkout and status requests and rejects unsafe redirects', async () => {
  const input = { id: fixtureId, amountIdr: price, planName: 'Veloxa Starter', email: owner.email!, now, expiryMinutes: 60 };
  assert.equal(duitkuConfig({ DUITKU_MERCHANT_CODE: 'TEST1', DUITKU_API_KEY: 'fixture-key', VELOXA_DUITKU_MODE: 'production',
    VELOXA_BILLING_ORIGIN: 'http://localhost:3035' }), null);
  assert.equal(duitkuConfig({ DUITKU_MERCHANT_CODE: 'TEST1', DUITKU_API_KEY: 'fixture-key', VELOXA_DUITKU_MODE: 'production',
    VELOXA_BILLING_ORIGIN: sandbox.origin })?.mode, 'production');
  const checkoutUrl = 'https://app-sandbox.duitku.com/redirect_checkout?reference=' + providerReference;
  assert.deepEqual(await createDuitkuInvoice(sandbox, input, async (target, options) => {
    assert.equal(target, 'https://api-sandbox.duitku.com/api/merchant/createInvoice');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('x-duitku-signature'), hmac(sandbox.merchantCode + now));
    assert.equal(headers.get('x-duitku-timestamp'), String(now));
    const body = JSON.parse(String(options?.body));
    assert.equal(body.merchantOrderId, fixtureId);
    assert.equal(body.paymentAmount, price);
    assert.equal(body.returnUrl, sandbox.origin + '/?billing=return');
    assert.equal(body.callbackUrl, sandbox.origin + '/api/veloxa/billing-webhook/');
    return json({ merchantCode: sandbox.merchantCode, reference: providerReference, statusCode: '00', paymentUrl: checkoutUrl });
  }), { reference: providerReference, paymentUrl: checkoutUrl + '&lang=id' });
  await assert.rejects(createDuitkuInvoice(sandbox, input, async () => json({
    merchantCode: sandbox.merchantCode, reference: providerReference, statusCode: '00', paymentUrl: checkoutUrl.replace('.duitku.com', '.duitku.com.attacker.test'),
  })), status(502));
  const result = await checkDuitkuInvoice(production, fixtureId, async (target, options) => {
    assert.equal(target, 'https://passport.duitku.com/webapi/api/merchant/transactionStatus');
    assert.deepEqual(JSON.parse(String(options?.body)), { merchantCode: production.merchantCode,
      merchantOrderId: fixtureId, signature: hmac(production.merchantCode + fixtureId) });
    return json({ merchantOrderId: fixtureId, reference: providerReference, statusCode: '01', amount: String(price) + '.00' });
  });
  assert.equal(result.amount, price);
  assert.equal(result.statusCode, '01');
  assert.deepEqual(await parseDuitkuCallback(callback(fixtureId), sandbox), { id: fixtureId, amount: price, reference: providerReference });
  await assert.rejects(parseDuitkuCallback(callback(fixtureId, { amount: '1' }), sandbox), status(403));
  await assert.rejects(readAdminBilling(new Request(url), { authorize: async () => owner }), status(403));
  await assert.rejects(confirmDuitkuPayment(callback(fixtureId), { config: null }), status(501));
});

test('emulator billing preserves checkout locks, validates confirmations and applies paid days exactly once', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):\d+$/);
  const app = initializeApp({ projectId: 'demo-veloxa-billing' }, 'veloxa-billing-emulator');
  const database = getFirestore(app);
  const id = workspaceId + Date.now();
  const ref = database.collection('workspaces').doc(id);
  const lock = (mode: DuitkuConfig['mode']) => ref.collection('private_billing_state').doc(`checkout_${mode}`);
  const orderIds: string[] = [];
  let fetched = 0;
  let createFails = false;
  let providerState = '01';
  let amount = price;
  let mode: DuitkuConfig['mode'] = 'sandbox';
  const fetcher: typeof fetch = async (target, options) => {
    fetched++;
    const body = JSON.parse(String(options?.body));
    if (String(target).endsWith('/createInvoice')) {
      orderIds.push(body.merchantOrderId);
      if (createFails) throw new Error('fixture network timeout');
      return json({ merchantCode: sandbox.merchantCode, reference: providerReference, statusCode: '00',
        paymentUrl: `https://app-${mode === 'sandbox' ? 'sandbox' : 'prod'}.duitku.com/redirect_checkout?reference=${providerReference}` });
    }
    return json({ merchantOrderId: body.merchantOrderId, reference: providerReference, statusCode: providerState, amount });
  };
  const authorizeWorkspace = async () => ({ user: owner, ref, workspace: (await ref.get()).data()!, workspaceId: id });
  const authorize = async () => ({ ...owner, role: 'admin' }) as DecodedIdToken;
  const deps = { database, config: sandbox as DuitkuConfig, authorizeWorkspace, authorize, now: () => now, fetcher };
  const request = (method: string, data: object) => new Request(url, { method, body: JSON.stringify({ workspaceId: id, ...data }) });
  const buy = () => beginWorkspaceInvoice(request('POST', { planId: 'starter_500k' }), deps);
  const read = () => readWorkspaceBilling(new Request(url + '?workspaceId=' + id), deps);
  const confirm = (order: string, overrides?: Record<string, string>) => confirmDuitkuPayment(callback(order, overrides), deps);
  try {
    await ref.set({ ownerUid: owner.uid, name: 'Berez Billing Test', subscriptionPlanId: 'free_trial', quotaUsed: 0, quotaLimit: 20 });
    assert.equal((await read()).mode, 'sandbox');
    await assert.rejects(beginWorkspaceInvoice(request('POST', { planId: 'starter_500k' }), { ...deps, config: null }), status(501));
    assert.equal(fetched, 0);
    const concurrent = await Promise.allSettled([buy(), buy()]);
    assert.equal(fetched, 1);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const first = orderIds.at(-1)!;
    await assert.rejects(confirm(first), status(503));
    assert.equal((await lock('sandbox').get()).get('invoiceId'), first);
    assert.equal((await ref.get()).get('subscriptionPlanId'), 'free_trial');
    providerState = '00';
    amount = 1;
    await assert.rejects(confirm(first), status(409));
    amount = price;
    await confirm(first);
    assert.equal((await read()).invoices[0].state, 'paid');
    assert.equal((await ref.get()).get('subscriptionPaidUntilMs'), undefined);
    assert.equal((await lock('sandbox').get()).exists, false);
    const { invoice: abandonedSandbox } = await buy();

    mode = 'production';
    deps.config = production;
    const { invoice: second } = await buy();
    assert.equal(second.state, 'pending');
    assert.equal((await lock('sandbox').get()).get('invoiceId'), abandonedSandbox.id);
    await Promise.all([confirm(second.id), confirm(second.id)]);
    assert.equal((await ref.get()).get('subscriptionPaidUntilMs'), now + accessMs);
    assert.equal((await read()).workspace.planId, 'starter_500k');
    assert.equal((await read()).publication.limit, SUBSCRIPTION_PLANS.starter_500k.monthlyPostQuota);
    await assert.rejects(beginWorkspaceInvoice(request('POST', { planId: 'growth_1000k' }), deps), status(409));
    const { invoice: renewal } = await buy();
    await confirm(renewal.id);
    assert.equal((await ref.get()).get('subscriptionPaidUntilMs'), now + accessMs * 2);
    const detail = await readAdminBilling(new Request(url + '?workspaceId=' + id), deps);
    assert.ok('costs' in detail);
    assert.equal(detail.costs.paidIdr, price * 2);
    assert.equal(detail.invoices.find(item => item.id === second.id)?.paymentUrl, null);

    createFails = true;
    await assert.rejects(buy(), status(502));
    const lost = orderIds.at(-1)!;
    assert.equal((await lock('production').get()).get('invoiceId'), lost);
    await assert.rejects(buy(), status(409));
    providerState = '02';
    const checked = await checkWorkspaceInvoice(request('PATCH', { invoiceId: lost }), deps);
    assert.equal(checked.invoice.state, 'cancelled');
    assert.equal((await lock('production').get()).exists, false);
    assert.equal((await ref.get()).get('subscriptionPaidUntilMs'), now + accessMs * 2);
  } finally {
    try {
      await Promise.all([database.recursiveDelete(ref), ...orderIds.map(id => database.collection('private_billing_order_index').doc(id).delete())]);
    } finally { await deleteApp(app); }
  }
});
