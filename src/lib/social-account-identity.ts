import type { ChannelConnectionState } from './veloxa-types';
export const MAX_PUBLISH_ACCOUNTS = 50;
export function socialConnectionId(channel: string, accountId: string) {
  if (!['facebook', 'instagram'].includes(channel) || !/^\d{1,128}$/.test(accountId)) throw new Error('Identitas akun sosial tidak valid.');
  return `${channel}_${accountId}`;
}
export function connectionKey(account: ChannelConnectionState) { return account.connectionId || (account.accountId ? socialConnectionId(account.channel, account.accountId) : account.channel); }
export function accountLabel(account: { accountName?: string; handle?: string }) { return account.handle || account.accountName || 'Akun sosial'; }
/** Preserve all server accounts; placeholders only represent unavailable/empty platforms. */
export function withConnectionPlaceholders(accounts: ChannelConnectionState[], defaults: ChannelConnectionState[]) {
  return [...accounts, ...defaults.filter(item => !accounts.some(account => account.channel === item.channel)).map(item => ({ ...item, connected: false, handle: '', accountName: 'Belum terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected' as const, lastPublishedAt: null }))];
}
