import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { draftBusiness, type BusinessContext } from '../business-context';
import type { MetaAdsDashboard, MetaAdsExecution } from '../meta-ads';
import type { ContentDraft } from '../veloxa-types';
import { requireWorkspace, workspaceIdSchema } from './auth';
import { resolveBusinessContext } from './business-contexts';
import { adminBucket } from './firebase';
import { ApiError, readJson } from './http';
import { decryptMetaToken } from './meta-crypto';
import { MetaRequestError } from './meta-graph';
import { META_ADS_SCOPES } from './meta-oauth';
import { adAccountFields, marketingGraph, metaAdsAccount, metaAdsGeo, metaNumericId, type MarketingGraph } from './meta-ads-graph';
import { readSocialAccounts } from './social-accounts';

type Ref = FirebaseFirestore.DocumentReference;
type Workspace = Awaited<ReturnType<typeof requireWorkspace>>;
type Data = FirebaseFirestore.DocumentData;
type Dependencies = { authorize?: typeof requireWorkspace; storage?: ReturnType<typeof adminBucket>; fetcher?: typeof fetch; decrypt?: typeof decryptMetaToken; now?: () => number };

const workspaceTarget = z.object({ workspaceId: workspaceIdSchema, businessId: z.string().regex(/^(primary|b_[a-f0-9-]{36})$/) });
const planId = z.string().regex(/^adcamp_[a-zA-Z0-9_-]{1,100}$/);
const prepareInput = workspaceTarget.extend({
  action: z.literal('prepare'), planId, adAccountId: metaNumericId,
  connectionId: z.string().regex(/^facebook_\d{1,32}$/), specialAdCategory: z.literal('NONE'),
}).strict();
const operationInput = z.discriminatedUnion('action', [prepareInput, ...(['activate', 'pause'] as const).map(action => workspaceTarget.extend({ action: z.literal(action), planId, confirm: z.literal(true) }).strict())]);

const websitePlan = z.object({
  id: planId,
  workspaceId: workspaceIdSchema,
  businessId: z.string().optional(),
  campaignName: z.string().trim().min(1).max(160),
  objective: z.literal('WEBSITE_CONVERSIONS'),
  destinationUrlOrWa: z.string().max(2000),
  promotedOfferingTitle: z.string().trim().min(1).max(200),
  originatedFromOrganicDraftId: z.string().regex(/^draft_[a-zA-Z0-9_-]{1,100}$/),
  destinationAccounts: z.array(z.object({ connectionId: z.string(), channel: z.string() })).max(50),
  demographics: z.object({
    ageMin: z.number().int().min(18).max(64), ageMax: z.number().int().min(19).max(65),
    genders: z.literal('all'), locations: z.array(z.object({ cityOrPinName: z.string().trim().min(1).max(250), radiusKm: z.number().int().min(3).max(80) })).length(1),
  }).refine(value => value.ageMax > value.ageMin),
  budget: z.object({
    appliedDailyBudgetIdr: z.number().int().min(25000), durationDays: z.number().int().min(1).max(90), totalBudgetIdr: z.number().int().positive(),
  }).refine(value => value.appliedDailyBudgetIdr * value.durationDays === value.totalBudgetIdr),
});

const minute = 60_000;
const operationTimeout = 5 * minute;
const executionRef = (ref: Ref, businessId: string, id: string) => ref.collection('meta_ads_executions').doc(createHash('sha256').update(JSON.stringify([businessId, id])).digest('hex'));
const credentialRef = (ref: Ref) => ref.collection('meta_ads_credentials').doc('current');
const isOperationInProgress = (row: Data) => ['preparing', 'activating', 'pausing'].includes(row.status);

function publicExecution(row: Data, now: number): MetaAdsExecution {
  const expiredOperation = isOperationInProgress(row) && Number(row.updatedAt) + operationTimeout < now;
  return {
    planId: row.planId, adAccountId: row.adAccountId, adAccountName: row.adAccountName,
    connectionId: row.connectionId, destinationUrl: row.destinationUrl, dailyBudgetIdr: row.dailyBudgetIdr,
    totalBudgetIdr: row.totalBudgetIdr, durationDays: row.durationDays, updatedAt: row.updatedAt,
    status: expiredOperation ? 'attention' : row.status,
    ...(row.title && { title: row.title }), ...(row.insights && { insights: row.insights }),
    ...(row.effectiveStatus && { effectiveStatus: row.effectiveStatus }),
    ...(row.campaignId && { campaignId: row.campaignId }), ...(row.adSetId && { adSetId: row.adSetId }),
    ...(row.adId && { adId: row.adId }), ...(row.endsAt && { endsAt: row.endsAt }),
    ...(expiredOperation ? { message: 'Proses terhenti. Periksa status kampanye di Meta Ads Manager.' } : row.message && { message: row.message }),
  };
}

function readCredential(row: Data | undefined, ownerUid: unknown, now: number) {
  if (!row || row.authorizedBy !== ownerUid) return { status: 'disconnected' as const };
  const missing = META_ADS_SCOPES.filter(scope => !Array.isArray(row.scopes) || !row.scopes.includes(scope));
  if (missing.length) return { status: 'permission_error' as const, missing };
  if (!Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0 || row.expiresAt > 0 && row.expiresAt <= now) return { status: 'expired' as const };
  if (typeof row.encryptedToken !== 'string' || !row.encryptedToken) return { status: 'permission_error' as const };
  return { status: 'connected' as const, token: row.encryptedToken, authorizedAt: row.authorizedAt };
}

function getMarketingGraph(credential: ReturnType<typeof readCredential>, ref: Ref, deps: Dependencies) {
  if (credential.status !== 'connected') throw new ApiError(409, 'Hubungkan kembali akun Meta Ads dan berikan izin yang diperlukan.', 'meta_ads_reconnect_required');
  try { return marketingGraph((deps.decrypt || decryptMetaToken)(credential.token, `${ref.id}/meta_ads`), deps.fetcher); }
  catch { throw new ApiError(409, 'Koneksi Meta Ads perlu dihubungkan kembali.', 'meta_ads_reconnect_required'); }
}

async function listIdentities(ref: Ref, context: BusinessContext, now: number, tx?: FirebaseFirestore.Transaction) {
  const query = ref.collection('private_meta_connections');
  const accounts = readSocialAccounts((await (tx ? tx.get(query) : query.get())).docs);
  return accounts.filter(row => row.channel === 'facebook' && (!row.expiresAt || row.expiresAt > now) && context.connectionIds.includes(row.connectionId));
}

async function insights(graph: MarketingGraph, id: string, now: number) {
  const [campaign, metrics] = await Promise.all([
    graph.get<Data>(id, { fields: 'effective_status' }),
    graph.get<{ data?: Data[] }>(`${id}/insights`, { fields: 'spend,impressions,clicks', date_preset: 'maximum' }),
  ]);
  const row = metrics.data?.[0];
  const values = [row?.spend, row?.impressions, row?.clicks].map(value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN);
  return {
    ...(typeof campaign.effective_status === 'string' && /^[A-Z_]{1,40}$/.test(campaign.effective_status) && { effectiveStatus: campaign.effective_status }),
    ...(values.every(value => Number.isFinite(value) && value >= 0) && { insights: { spendIdr: values[0], impressions: values[1], clicks: values[2], asOf: now } }),
  };
}

export async function getMetaAds(request: Request, deps: Dependencies = {}): Promise<MetaAdsDashboard> {
  const query = new URL(request.url).searchParams;
  const input = workspaceTarget.parse({ workspaceId: query.get('workspaceId'), businessId: query.get('businessId') });
  const { user, workspace, ref } = await (deps.authorize || requireWorkspace)(request, input.workspaceId);
  const now = (deps.now || Date.now)();
  const { context } = await resolveBusinessContext(ref, workspace, input.businessId);
  const owner = workspace.ownerUid === user.uid;
  const [stored, rows, pages] = await Promise.all([
    credentialRef(ref).get(),
    ref.collection('meta_ads_executions').where('businessId', '==', context.id).limit(101).get(),
    listIdentities(ref, context, now),
  ]);
  const credential = readCredential(stored.data(), workspace.ownerUid, now);
  const campaigns = rows.docs.map(doc => publicExecution(doc.data(), now)).sort((a, b) => b.updatedAt - a.updatedAt);
  const result: MetaAdsDashboard = {
    canManage: owner, canPrepare: owner, connection: credential.status,
    ...(credential.missing && { missingScopes: credential.missing }),
    accounts: [], identities: pages.map(page => ({ connectionId: page.connectionId, name: page.accountName })), campaigns,
  };
  if (!owner || credential.status !== 'connected') return result;
  try {
    const graph = getMarketingGraph(credential, ref, deps);
    result.accounts = (await graph.list('me/adaccounts', { fields: adAccountFields })).map(metaAdsAccount).filter(account => account !== null);
    await Promise.all(campaigns.filter(campaign => campaign.campaignId && ['active', 'paused', 'attention'].includes(campaign.status)).slice(0, 5).map(async campaign => {
      try {
        const metrics = await insights(graph, campaign.campaignId!, now);
        const execution = executionRef(ref, context.id, campaign.planId);
        await ref.firestore.runTransaction(async tx => {
          const current = (await tx.get(execution)).data();
          if (current?.campaignId === campaign.campaignId && current?.updatedAt === campaign.updatedAt && (current?.metricsCheckedAt || 0) < now) {
            tx.update(execution, { ...metrics, metricsCheckedAt: now });
          }
        });
        Object.assign(campaign, metrics);
      }
      catch { /* Previously confirmed IDs remain available during a reporting failure. */ }
    }));
  } catch (error) {
    result.connection = error instanceof MetaRequestError && error.providerCode === 190 || error instanceof ApiError && error.code === 'meta_ads_reconnect_required'
      ? 'expired' : error instanceof MetaRequestError && [10, 200].includes(error.providerCode || 0) ? 'permission_error' : 'unavailable';
  }
  return result;
}

function assertOwner(workspace: Data | undefined, uid: string) {
  if (!workspace || workspace.ownerUid !== uid) throw new ApiError(403, 'Hanya pemilik workspace yang dapat mengelola kampanye Meta Ads.', 'forbidden');
}

function savedPlan(workspace: Data, ref: Ref, id: string, context: BusinessContext) {
  let raw: unknown;
  try { raw = JSON.parse(String(workspace.snapshotJson)).metaAdCampaigns; } catch { throw new ApiError(409, 'Rancangan bisnis belum dapat dibaca.'); }
  const matches = Array.isArray(raw) ? raw.filter(item => item?.id === id && (item.businessId || 'primary') === context.id) : [];
  const plan = websitePlan.safeParse(matches.length === 1 ? matches[0] : null);
  if (!plan.success || plan.data.workspaceId !== ref.id) throw new ApiError(409, 'Siapkan rancangan kunjungan website dari satu gambar Studio pada bisnis ini.', 'meta_ads_plan_unsupported');
  return plan.data;
}

function validateDestination(raw: string, profileWebsite: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== new URL(profileWebsite).href) throw new Error();
    return url.href;
  } catch { throw new ApiError(409, 'Website HTTPS pada rancangan harus sama dengan profil bisnis aktif.', 'meta_ads_destination_mismatch'); }
}

async function verifiedPage(graph: MarketingGraph, pageId: string) {
  // promote_pages is promotion history. Check the ad token owner's current Page
  // tasks instead; Meta validates the Page/ad account pairing on creative creation.
  const pages = await graph.list('me/accounts', { fields: 'id,tasks' });
  const adTasks = ['ADVERTISE', 'MANAGE', 'PROFILE_PLUS_ADVERTISE', 'PROFILE_PLUS_FULL_CONTROL'];
  if (!pages.some(page => page.id === pageId && Array.isArray(page.tasks) && page.tasks.some(task => adTasks.includes(task)))) {
    throw new ApiError(409, 'Akun Facebook yang menghubungkan Meta Ads belum memiliki izin membuat iklan untuk Halaman ini.', 'meta_ads_page_ineligible');
  }
}

async function verifiedAccount(graph: MarketingGraph, accountId: string) {
  const account = metaAdsAccount(await graph.get(`act_${accountId}`, { fields: adAccountFields }));
  if (!account || account.id !== accountId || !account.eligible) throw new ApiError(409, 'Pilih akun iklan aktif dengan mata uang IDR dan izin beriklan.', 'meta_ads_account_ineligible');
  return account;
}

async function updateOperation(ref: Ref, operation: string, updates: Data, now: number) {
  const changes = { ...updates, updatedAt: now };
  return ref.firestore.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (!row || row.operation !== operation) throw new ApiError(409, 'Operasi Meta Ads sedang ditangani oleh proses lain.');
    tx.update(ref, changes);
    return { ...row, ...changes };
  });
}

async function prepareCampaign(args: Workspace, context: BusinessContext, input: z.infer<typeof prepareInput>, deps: Dependencies, now: () => number) {
  const { ref, workspace, user } = args;
  const campaign = executionRef(ref, context.id, input.planId);
  const existing = (await campaign.get()).data();
  if (existing) return publicExecution(existing, now());
  const plan = savedPlan(workspace, ref, input.planId, context);
  if (!plan.destinationAccounts.some(account => account.connectionId === input.connectionId && account.channel === 'facebook')) {
    throw new ApiError(409, 'Facebook Page perlu dipilih pada rancangan bisnis ini.', 'meta_ads_page_mismatch');
  }
  const destinationUrl = validateDestination(plan.destinationUrlOrWa, context.brand.websiteUrl);
  const [pages, stored, grant] = await Promise.all([
    listIdentities(ref, context, now()),
    ref.collection('social_drafts').doc(plan.originatedFromOrganicDraftId).get(),
    credentialRef(ref).get(),
  ]);
  const page = pages.find(account => account.connectionId === input.connectionId);
  if (!page || !metaNumericId.safeParse(page.accountId).success) throw new ApiError(409, 'Hubungkan Facebook Page ke bisnis ini sebelum membuat iklan.', 'meta_ads_page_ineligible');
  const source = stored.data();
  const draft = source?.draft as ContentDraft | undefined;
  if (!draft || draft.id !== plan.originatedFromOrganicDraftId || draft.workspaceId !== ref.id || draftBusiness(draft) !== context.id || draft.format !== 'single_post' || draft.renderedMedia?.mimeType !== 'image/jpeg' || typeof draft.caption !== 'string' || !draft.caption.trim() || typeof source?.storagePath !== 'string' || !source.storagePath.startsWith(`workspaces/${ref.id}/renders/`)) {
    throw new ApiError(409, 'Gambar Studio untuk iklan tidak tersedia di bisnis ini.', 'meta_ads_source_unavailable');
  }
  const credential = readCredential(grant.data(), user.uid, now());
  const graph = getMarketingGraph(credential, ref, deps);
  const { cityOrPinName, radiusKm } = plan.demographics.locations[0];
  const [account, geo, , media] = await Promise.all([
    verifiedAccount(graph, input.adAccountId), metaAdsGeo(graph, cityOrPinName, radiusKm),
    verifiedPage(graph, page.accountId), (deps.storage || adminBucket()).file(source.storagePath).download(),
  ]);
  if (!media[0]?.length || media[0].length > 8 * 1024 * 1024 || media[0][0] !== 0xff || media[0][1] !== 0xd8) throw new ApiError(409, 'Gambar JPEG iklan belum tersedia atau melebihi batas unggah.', 'meta_ads_source_unavailable');
  const operation = randomUUID();
  const startsAt = now() + 3 * minute;
  const endsAt = startsAt + plan.budget.durationDays * 24 * 60 * minute;
  const targeting = {
    geo_locations: geo,
    age_min: plan.demographics.ageMin,
    age_max: plan.demographics.ageMax,
    publisher_platforms: ['facebook'],
    targeting_automation: { advantage_audience: 0 },
  };
  const initial = {
    planId: input.planId, title: plan.campaignName, businessId: context.id, adAccountId: account.id, adAccountName: account.name,
    ownerUid: user.uid, pageId: page.accountId, connectionId: page.connectionId, status: 'preparing', operation,
    destinationUrl, startsAt, endsAt, dailyBudgetIdr: plan.budget.appliedDailyBudgetIdr,
    totalBudgetIdr: plan.budget.totalBudgetIdr, durationDays: plan.budget.durationDays, targeting,
    createdAt: now(), updatedAt: now(),
  };
  const previous = await ref.firestore.runTransaction(async tx => {
    const row = (await tx.get(campaign)).data();
    if (row) return row;
    const latest = (await tx.get(ref)).data();
    assertOwner(latest, user.uid);
    const latestGrant = (await tx.get(credentialRef(ref))).data();
    const latestContext = (await resolveBusinessContext(ref, latest!, context.id, tx)).context;
    if (latest!.snapshotJson !== workspace.snapshotJson || latestContext.revision !== context.revision || latestGrant?.encryptedToken !== grant.data()?.encryptedToken || !(await listIdentities(ref, latestContext, now(), tx)).some(item => item.connectionId === page.connectionId)) {
      throw new ApiError(409, 'Rancangan, akun, atau koneksi berubah. Tinjau kembali sebelum melanjutkan.');
    }
    tx.create(campaign, initial);
    return null;
  });
  if (previous) return publicExecution(previous, now());

  const accountPath = `act_${account.id}`;
  const name = `${plan.campaignName} [Veloxa ${campaign.id.slice(0, 12)}]`;
  try {
    const imageHash = await graph.uploadImage(account.id, media[0]);
    const campaignId = await graph.create(`${accountPath}/campaigns`, {
      name, objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: '[]', buying_type: 'AUCTION', is_adset_budget_sharing_enabled: 'false',
    });
    await updateOperation(campaign, operation, { campaignId }, now());
    const adSetId = await graph.create(`${accountPath}/adsets`, {
      campaign_id: campaignId, name, optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', status: 'PAUSED',
      // Meta's budget offset for IDR is one. No scaling from rupiah is needed.
      destination_type: 'WEBSITE', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', lifetime_budget: String(initial.totalBudgetIdr),
      start_time: new Date(startsAt).toISOString(), end_time: new Date(endsAt).toISOString(),
      targeting: JSON.stringify(targeting),
    });
    await updateOperation(campaign, operation, { adSetId }, now());
    const creativeId = await graph.create(`${accountPath}/adcreatives`, {
      name, object_story_spec: JSON.stringify({ page_id: page.accountId, link_data: { link: destinationUrl, image_hash: imageHash,
        name: plan.promotedOfferingTitle, message: draft.caption.trim().slice(0, 2200), call_to_action: { type: 'LEARN_MORE' } } }),
    });
    await updateOperation(campaign, operation, { creativeId }, now());
    const adId = await graph.create(`${accountPath}/ads`, { name, adset_id: adSetId, creative: JSON.stringify({ creative_id: creativeId }), status: 'PAUSED' });
    return publicExecution(await updateOperation(campaign, operation, { adId, status: 'paused', operation: null }, now()), now());
  } catch (error) {
    const message = error instanceof MetaRequestError && !error.uncertain
      ? 'Meta menolak salah satu langkah pembuatan iklan. Periksa izin, materi, dan anggaran di Ads Manager.'
      : 'Pembuatan belum terkonfirmasi. Periksa Ads Manager sebelum mencoba lagi.';
    return publicExecution(await updateOperation(campaign, operation, { status: 'attention', operation: null, message }, now()), now());
  }
}

function matchesTargeting(actual: Data | undefined, expected: Data | undefined) {
  if (!expected || !actual || actual.age_min !== expected.age_min || actual.age_max !== expected.age_max ||
      actual.targeting_automation?.advantage_audience !== 0 || actual.publisher_platforms?.length !== 1 || actual.publisher_platforms[0] !== 'facebook') return false;
  const geo = actual.geo_locations;
  if (!geo || Object.keys(geo).some(key => !['location_types', 'countries', 'cities'].includes(key) && geo[key]?.length !== 0)) return false;
  if (expected.geo_locations.countries) return geo.countries?.length === 1 && geo.countries[0] === 'ID' && !geo.cities?.length;
  const city = geo.cities?.[0];
  const selected = expected.geo_locations.cities[0];
  return !geo.countries?.length && geo.cities?.length === 1 && city.key === selected.key && city.radius === selected.radius && city.distance_unit === selected.distance_unit;
}

async function assertRemoteCampaign(graph: MarketingGraph, row: Data, now: number) {
  const [campaign, adSet, ad, creative, adSets, ads] = await Promise.all([
    graph.get<Data>(row.campaignId, { fields: 'id,account_id,status,objective,daily_budget,lifetime_budget,special_ad_categories' }),
    graph.get<Data>(row.adSetId, { fields: 'id,account_id,campaign_id,status,lifetime_budget,daily_budget,end_time,targeting' }),
    graph.get<Data>(row.adId, { fields: 'id,account_id,adset_id,status,creative{id}' }),
    graph.get<Data>(row.creativeId, { fields: 'id,object_story_spec' }),
    graph.list(`${row.campaignId}/adsets`, { fields: 'id', limit: '2' }),
    graph.list(`${row.adSetId}/ads`, { fields: 'id', limit: '2' }),
  ]);
  if (campaign.id !== row.campaignId || campaign.account_id !== row.adAccountId || campaign.status !== 'PAUSED' || campaign.objective !== 'OUTCOME_TRAFFIC' || Number(campaign.daily_budget || 0) !== 0 || Number(campaign.lifetime_budget || 0) !== 0 || !Array.isArray(campaign.special_ad_categories) || campaign.special_ad_categories.some((value: unknown) => value !== 'NONE') ||
      adSet.id !== row.adSetId || adSet.account_id !== row.adAccountId || adSet.campaign_id !== row.campaignId || !['PAUSED', 'ACTIVE'].includes(adSet.status) || Number(adSet.lifetime_budget) !== row.totalBudgetIdr || Number(adSet.daily_budget || 0) !== 0 || Date.parse(adSet.end_time) <= now || Math.abs(Date.parse(adSet.end_time) - row.endsAt) >= 1000 || !Number.isFinite(Date.parse(adSet.end_time)) || !matchesTargeting(adSet.targeting, row.targeting) ||
      ad.id !== row.adId || ad.account_id !== row.adAccountId || ad.adset_id !== row.adSetId || !['PAUSED', 'ACTIVE'].includes(ad.status) || ad.creative?.id !== row.creativeId ||
      creative.id !== row.creativeId || creative.object_story_spec?.page_id !== row.pageId || creative.object_story_spec?.link_data?.link !== row.destinationUrl ||
      adSets.length !== 1 || adSets[0].id !== row.adSetId || ads.length !== 1 || ads[0].id !== row.adId) {
    throw new ApiError(409, 'Kampanye atau anggaran berubah di Meta. Tinjau kampanye di Ads Manager.', 'meta_ads_remote_changed');
  }
}

async function pauseRemoteCampaign(graph: MarketingGraph, row: Data) {
  const remote = await graph.get<Data>(row.campaignId, { fields: 'id,account_id' });
  if (remote.id !== row.campaignId || remote.account_id !== row.adAccountId) throw new ApiError(409, 'Kampanye tidak cocok dengan akun Meta Ads ini.');
  await graph.status(row.campaignId, 'PAUSED');
}

async function changeCampaignStatus(args: Workspace, context: BusinessContext, input: Exclude<z.infer<typeof operationInput>, z.infer<typeof prepareInput>>, deps: Dependencies, now: () => number) {
  const { ref, user } = args;
  const campaign = executionRef(ref, context.id, input.planId);
  const activate = input.action === 'activate';
  const operation = randomUUID();
  const claimed = await ref.firestore.runTransaction(async tx => {
    const [snapshot, grant, latest] = await Promise.all([tx.get(campaign), tx.get(credentialRef(ref)), tx.get(ref)]);
    const workspace = latest.data();
    assertOwner(workspace, user.uid);
    const row = snapshot.data();
    if (!row || !metaNumericId.safeParse(row.campaignId).success || row.businessId !== context.id) throw new ApiError(404, 'Kampanye Meta belum tersedia untuk bisnis ini.');
    if (isOperationInProgress(row) && Number(row.updatedAt) + operationTimeout >= now()) throw new ApiError(409, 'Operasi kampanye sedang berjalan. Muat ulang status sebentar lagi.');
    if (activate) {
      const currentContext = (await resolveBusinessContext(ref, workspace!, context.id, tx)).context;
      const pages = await listIdentities(ref, currentContext, now(), tx);
      if (row.status !== 'paused' || row.ownerUid !== user.uid || !row.adSetId || !row.adId || !row.creativeId || row.endsAt <= now() || !pages.some(item => item.connectionId === row.connectionId && item.accountId === row.pageId)) {
        throw new ApiError(409, 'Kampanye harus lengkap, dijeda, dan masih terhubung ke bisnis sebelum diaktifkan.', 'meta_ads_cannot_activate');
      }
      validateDestination(row.destinationUrl, currentContext.brand.websiteUrl);
    }
    const currentGrant = grant.data();
    const credential = readCredential(currentGrant, user.uid, now());
    const pauseCredential = readCredential(row.pauseGrant, user.uid, now());
    if (credential.status !== 'connected' && (activate || pauseCredential.status !== 'connected')) throw new ApiError(409, 'Hubungkan kembali Meta Ads sebelum mengubah status kampanye.', 'meta_ads_reconnect_required');
    tx.update(campaign, {
      status: activate ? 'activating' : 'pausing', operation, updatedAt: now(), message: null,
      // A later connection can select a different Meta profile. Preserve the original owner grant for stopping delivery.
      ...(activate && { pauseGrant: { authorizedBy: user.uid, scopes: currentGrant!.scopes, encryptedToken: currentGrant!.encryptedToken,
        expiresAt: currentGrant!.expiresAt ? Math.min(currentGrant!.expiresAt, row.endsAt) : row.endsAt } }),
    });
    return { row, credential, pauseCredential };
  });
  const { row, credential, pauseCredential } = claimed;
  try {
    if (activate) {
      const graph = getMarketingGraph(credential, ref, deps);
      await Promise.all([verifiedAccount(graph, row.adAccountId), verifiedPage(graph, row.pageId), assertRemoteCampaign(graph, row, now())]);
      await graph.status(row.adId, 'ACTIVE');
      await graph.status(row.adSetId, 'ACTIVE');
      const [latest, grant] = await Promise.all([ref.get(), credentialRef(ref).get()]);
      const workspace = latest.data();
      assertOwner(workspace, user.uid);
      const { context: latestContext } = await resolveBusinessContext(ref, workspace!, context.id);
      if (readCredential(grant.data(), user.uid, now()).token !== credential.token || !(await listIdentities(ref, latestContext, now())).some(item => item.connectionId === row.connectionId && item.accountId === row.pageId)) {
        throw new ApiError(409, 'Koneksi atau identitas Facebook berubah sebelum aktivasi.');
      }
      validateDestination(row.destinationUrl, latestContext.brand.websiteUrl);
      await graph.status(row.campaignId, 'ACTIVE');
    } else {
      try { await pauseRemoteCampaign(getMarketingGraph(credential, ref, deps), row); }
      catch (error) {
        if (pauseCredential.status !== 'connected' || pauseCredential.token === credential.token) throw error;
        await pauseRemoteCampaign(getMarketingGraph(pauseCredential, ref, deps), row);
      }
    }
    return publicExecution(await updateOperation(campaign, operation, { status: activate ? 'active' : 'paused', effectiveStatus: null, operation: null, message: null, ...(!activate && { pauseGrant: null }) }, now()), now());
  } catch (error) {
    const message = error instanceof ApiError && error.status < 500 ? error.message : 'Perubahan status belum terkonfirmasi. Periksa Meta Ads Manager atau jeda kampanye dari Veloxa.';
    return publicExecution(await updateOperation(campaign, operation, { status: 'attention', operation: null, message }, now()), now());
  }
}

export async function mutateMetaAds(request: Request, deps: Dependencies = {}) {
  const input = operationInput.parse(await readJson(request));
  const args = await (deps.authorize || requireWorkspace)(request, input.workspaceId, true);
  assertOwner(args.workspace, args.user.uid);
  const { context } = await resolveBusinessContext(args.ref, args.workspace, input.businessId);
  const now = deps.now || Date.now;
  const campaign = input.action === 'prepare' ? await prepareCampaign(args, context, input, deps, now) : await changeCampaignStatus(args, context, input, deps, now);
  return { campaign };
}
