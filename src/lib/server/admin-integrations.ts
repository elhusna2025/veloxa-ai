import type { Firestore } from 'firebase-admin/firestore';
import type { AdminIntegrationStatus } from '../admin-integrations';
import { requirePlatformOperator, type requireUser, workspaceIdSchema } from './auth';
import { loadBusinessContexts } from './business-contexts';
import { adminDb } from './firebase';
import { ApiError } from './http';
import { META_ADS_SCOPES } from './meta-oauth';
import { readSocialAccounts } from './social-accounts';

const campaignStates = new Set(['preparing', 'paused', 'activating', 'active', 'pausing', 'attention']);
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 180) : fallback;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export async function getAdminIntegrations(request: Request, deps: { authorize?: typeof requireUser; database?: Firestore; now?: () => number } = {}): Promise<AdminIntegrationStatus> {
  await requirePlatformOperator(request, deps.authorize);
  const workspaceId = workspaceIdSchema.parse(new URL(request.url).searchParams.get('workspaceId'));
  const db = deps.database ?? adminDb();
  const ref = db.collection('workspaces').doc(workspaceId);
  const workspace = (await ref.get()).data();
  if (!workspace) throw new ApiError(404, 'Workspace tidak ditemukan.');
  const now = (deps.now ?? Date.now)();

  const [businesses, social, ads, executions] = await Promise.all([
    workspace.snapshotJson ? loadBusinessContexts(ref, workspace).catch(error => {
      if (error instanceof ApiError && error.code === 'business_context_invalid') return [];
      throw error;
    }) : [],
    ref.collection('private_meta_connections').select('channel', 'accountId', 'accountName', 'handle', 'expiresAt').get(),
    db.getAll(ref.collection('meta_ads_credentials').doc('current'), { fieldMask: ['scopes', 'expiresAt', 'authorizedBy'] }),
    ref.collection('meta_ads_executions').orderBy('updatedAt', 'desc').limit(25)
      .select('planId', 'title', 'businessId', 'adAccountName', 'status', 'updatedAt', 'totalBudgetIdr', 'insights').get(),
  ]);

  const credential = ads[0]?.data();
  const owned = credential && typeof workspace.ownerUid === 'string' && credential.authorizedBy === workspace.ownerUid;
  const expiresAt = owned ? number(credential.expiresAt) : null;
  const scopes = Array.isArray(credential?.scopes) ? credential.scopes : [];
  const advertisingStatus = !owned ? 'disconnected' : !META_ADS_SCOPES.every(scope => scopes.includes(scope)) ? 'permission_error'
    : expiresAt === null || expiresAt > 0 && expiresAt <= now ? 'expired' : 'connected';
  const workspaceName = text(workspace.name, workspaceId);
  const businessName = (id: unknown) => businesses.find(business => business.id === id)?.brand.businessName || workspaceName;
  const accounts = readSocialAccounts(social.docs).map(account => ({
    id: account.connectionId,
    channel: account.channel,
    label: text(account.handle, text(account.accountName, account.channel)),
    business: businesses.find(business => business.connectionIds.includes(account.connectionId))?.brand.businessName ?? null,
    expiresAt: number(account.expiresAt) || null,
  }));

  const campaigns = executions.docs.flatMap((doc): AdminIntegrationStatus['campaigns'] => {
    const row = doc.data();
    const updatedAt = number(row.updatedAt);
    const totalBudgetIdr = number(row.totalBudgetIdr);
    if (!campaignStates.has(row.status) || updatedAt === null || totalBudgetIdr === null) return [];
    const spendIdr = number(row.insights?.spendIdr);
    const impressions = number(row.insights?.impressions);
    const clicks = number(row.insights?.clicks);
    const asOf = number(row.insights?.asOf);
    return [{ id: doc.id, title: text(row.title, 'Kampanye Meta'), business: businessName(row.businessId),
      status: row.status, accountName: text(row.adAccountName, 'Akun iklan Meta'), updatedAt, totalBudgetIdr,
      ...(spendIdr !== null && impressions !== null && clicks !== null && asOf !== null ? { insights: { spendIdr, impressions, clicks, asOf } } : {}),
    }];
  });
  return { workspaceName, advertising: { status: advertisingStatus, expiresAt: expiresAt || null }, accounts, campaigns };
}
