import { z } from 'zod';
import { socialConnectionId } from '../social-account-identity';
import type { ChannelConnectionState } from '../veloxa-types';
import { ApiError } from './http';
import { getMetaLoginProvider, type MetaConnection } from './meta-graph';
export { socialConnectionId } from '../social-account-identity';
export const connectionIdSchema = z.string().regex(/^(facebook|instagram)_\d{1,128}$/);
type AccountDoc = { id: string; data(): unknown };
export type StoredAccount = MetaConnection & { connectionId: string; storageId: string };
/** Stable records take precedence over a legacy singleton of the same account. */
export function readSocialAccounts(docs: AccountDoc[]): StoredAccount[] {
  const records = new Map<string, StoredAccount>();
  for (const doc of docs) {
    const value = doc.data() as MetaConnection | undefined;
    if (!value || !['instagram','facebook'].includes(value.channel) || !/^\d{1,128}$/.test(value.accountId || '')) continue;
    const id = socialConnectionId(value.channel,value.accountId);
    if (doc.id !== id && doc.id !== value.channel) continue;
    if (!records.has(id) || doc.id === id) records.set(id,{ ...value, connectionId:id, storageId:doc.id });
  }
  return [...records.values()];
}
export function publicSocialAccount(value: MetaConnection): ChannelConnectionState {
  return { connectionId:socialConnectionId(value.channel,value.accountId), accountId:value.accountId, loginProvider:getMetaLoginProvider(value.loginProvider), channel:value.channel, connected:!value.expiresAt || value.expiresAt>Date.now(), accountName:value.accountName, handle:value.handle, followerCount:0, oauthMode:value.expiresAt && value.expiresAt<=Date.now()?'pending_review':'direct_publish',tokenExpiresAt:value.expiresAt?new Date(value.expiresAt).toISOString():null,lastPublishedAt:value.lastPublishedAt||null };
}
export function assertNotDisconnected(guard: {disconnectedAt?: number}|undefined, authorizedAt: unknown) {
  if (guard?.disconnectedAt && (typeof authorizedAt!=='number' || authorizedAt<=guard.disconnectedAt)) throw new ApiError(409,'Akun ini sudah diputus. Berikan izin baru untuk menghubungkannya kembali.','reconnect_required');
}
