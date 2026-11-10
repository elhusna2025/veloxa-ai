import { ApiError } from './http';
import { getMetaLoginProvider, type MetaChannel, type MetaLoginProvider } from './meta-graph';
import { connectionIdSchema, socialConnectionId, type StoredAccount } from './social-accounts';
import { MAX_PUBLISH_ACCOUNTS } from '../social-account-identity';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import type { ContentDraft, SubscriptionPlanId } from '../veloxa-types';
export type AccountTarget={connectionId:string;channel:MetaChannel;accountId:string;accountName:string;handle:string;loginProvider:MetaLoginProvider};
export function selectDraftAccounts(accounts:StoredAccount[],ids:string[]|undefined,planId:SubscriptionPlanId) {
 // Legacy clients can retain singleton behavior, but may never implicitly fan out to new accounts.
 if(ids===undefined&&accounts.some(account=>account.storageId!==account.channel))throw new ApiError(409,'Pilih akun tujuan di Studio sebelum membuat konten.','select_accounts');
 const chosen=ids===undefined?accounts.filter(account=>!account.expiresAt||account.expiresAt>Date.now()):ids.map(id=>{const item=accounts.find(account=>account.connectionId===id);if(!item)throw new ApiError(409,'Akun tujuan tidak tersedia di workspace ini.','target_changed');return item;});
 if(!chosen.length)throw new ApiError(409,'Pilih setidaknya satu akun tujuan yang terhubung.','select_accounts');
 if(chosen.length>MAX_PUBLISH_ACCOUNTS||new Set(chosen.map(item=>item.connectionId)).size!==chosen.length)throw new ApiError(400,'Daftar akun tujuan tidak valid.');
 for(const account of chosen){if(account.expiresAt&&account.expiresAt<=Date.now())throw new ApiError(409,'Hubungkan ulang akun tujuan yang izinnya berakhir.');if(!SUBSCRIPTION_PLANS[planId].allowedChannels.includes(account.channel))throw new ApiError(403,'Akun tujuan tidak termasuk dalam paket workspace.');}
 return chosen;
}
export function toAccountTarget(account:StoredAccount):AccountTarget{return{connectionId:account.connectionId,channel:account.channel,accountId:account.accountId,accountName:account.accountName,handle:account.handle,loginProvider:getMetaLoginProvider(account.loginProvider)};}
export function storedAccountTargets(stored:Record<string,any>,draft:ContentDraft):AccountTarget[]{
 const source=stored.targetBindings??draft.publishTargets;
 if(!Array.isArray(source)||!source.length||source.length>MAX_PUBLISH_ACCOUNTS)throw new ApiError(409,'Tujuan draf belum dapat diverifikasi. Buat draf baru.','target_changed');
 const targets:AccountTarget[]=source.map((item:any)=>{
  if(!['facebook','instagram'].includes(item.channel)||!/^\d{1,128}$/.test(item.accountId))throw new ApiError(409,'Identitas tujuan draf tidak valid.','target_changed');
  const key=socialConnectionId(item.channel,item.accountId);
  if(item.connectionId!==undefined&&connectionIdSchema.parse(item.connectionId)!==key)throw new ApiError(409,'Identitas koneksi draf berubah.','target_changed');
  const provider=stored.targetBindings?getMetaLoginProvider(item.loginProvider):getMetaLoginProvider(stored.targetProviders?.[item.channel]);
  if(!stored.targetBindings&&stored.targetAccounts?.[item.channel]!==item.accountId)throw new ApiError(409,'Akun tujuan draf lama belum dapat diverifikasi.','target_changed');
  return{connectionId:key,channel:item.channel,accountId:item.accountId,accountName:item.accountName||'',handle:item.handle||'',loginProvider:provider};
 });
 if(new Set(targets.map(item=>item.connectionId)).size!==targets.length)throw new ApiError(409,'Draf memiliki tujuan duplikat.','target_changed');
 if(!stored.targetBindings&&targets.some(item=>targets.filter(other=>other.channel===item.channel).length>1))throw new ApiError(409,'Draf lama memiliki akun tujuan ambigu. Buat draf baru.','target_changed');
 return targets;
}
export function assertTargetBinding(account:StoredAccount|undefined,target:AccountTarget){
 if(!account)throw new ApiError(409,'Akun tujuan berubah atau diputus sejak draf dibuat. Tinjau kembali akun tujuan.','target_changed');
 if(account.expiresAt&&account.expiresAt<=Date.now())throw new ApiError(409,'Izin akun tujuan berakhir. Hubungkan ulang akun.','reconnect_required');
 if(account.accountId!==target.accountId||account.channel!==target.channel||getMetaLoginProvider(account.loginProvider)!==target.loginProvider)throw new ApiError(409,'Akun atau metode koneksi berubah sejak draf dibuat. Buat draf baru dan tinjau kembali.','target_changed');
 if(target.channel==='facebook'&&target.loginProvider!=='facebook')throw new ApiError(409,'Koneksi Instagram tidak dapat menerbitkan ke Facebook.');
}
