import type { ChannelConnectionState } from './veloxa-types';
export type SocialProvider = 'instagram' | 'facebook';
const numericId = /^\d{1,128}$/;
/** Account identity never comes from a username or display name. */
export function accountIdForChannel(account: ChannelConnectionState, provider: string): string | null {
  if (account.channel !== provider) return null;
  if (account.accountId && numericId.test(account.accountId)) return account.accountId;
  const prefix = provider + '_';
  const suffix = account.connectionId?.startsWith(prefix) ? account.connectionId.slice(prefix.length) : '';
  return numericId.test(suffix) ? suffix : null;
}
export function socialAccountOptions(provider: SocialProvider, candidates: {id:string;label:string}[], connections: ChannelConnectionState[], reconnectId: string | null = null) {
  const seen = new Set<string>();
  return candidates.filter(item => numericId.test(item.id) && !seen.has(item.id) && Boolean(seen.add(item.id)))
    .filter(item => !reconnectId || item.id === reconnectId)
    .map(item => {
      const existing = connections.find(account => accountIdForChannel(account, provider) === item.id);
      return {...item, existing, eligible: reconnectId ? item.id === reconnectId && Boolean(existing) : !existing};
    });
}
export function eligibleSocialChoices(options: {id:string;eligible:boolean}[], chosen: string[]) {
  const allowed = new Set(options.filter(item => item.eligible).map(item => item.id));
  return [...new Set(chosen)].filter(id => allowed.has(id));
}
export function parseReconnectIntent(raw: string | null, workspaceId: string, provider: SocialProvider, now = Date.now()): {accountId:string} | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value?.version === 1 && value.workspaceId === workspaceId && value.provider === provider && typeof value.accountId === 'string' && numericId.test(value.accountId) && Number.isFinite(value.createdAt) && value.createdAt <= now && now - value.createdAt <= 15 * 60_000 ? {accountId:value.accountId} : null;
  } catch { return null; }
}
