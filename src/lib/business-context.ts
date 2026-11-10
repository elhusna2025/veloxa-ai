import type { BrandProfile, BrandVaultAsset, ChannelConnectionState, ContentDraft } from './veloxa-types';
import { socialConnectionId } from './social-account-identity';
export const PRIMARY_BUSINESS = 'primary';
export const BUSINESS_DAYS = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'] as const;
export interface BusinessSchedule { connectionIds:string[]; timesWib:string[]; days:string[] }
export interface BusinessContext { id:string; revision:number; brand:BrandProfile; connectionIds:string[]; schedule:BusinessSchedule }
export function businessId(value:unknown):string {
  if(value === undefined || value === null || value === '')return PRIMARY_BUSINESS;
  if(typeof value !== 'string' || !/^(primary|b_[a-f0-9-]{36})$/.test(value))throw new Error('Identitas bisnis tidak valid.');
  return value;
}
export function blankBusinessProfile(workspaceId:string,id:string,name:string):BrandProfile {
  return {workspaceId,businessId:id,businessName:name.trim(),businessDescription:'',category:'custom',city:'',targetAudience:'',brandTone:'',primaryColorHex:'#18181B',accentColorHex:'#FFFFFF',visualVibe:'Profesional dan sesuai konteks bisnis.',defaultCta:'Pelajari selengkapnya',whatsappNumber:'',websiteUrl:'',forbiddenWords:[],prioritizeRealAssets:false,offerings:[]};
}
export function businessTargetId(target:{connectionId?:string;channel:string;accountId:string}):string {
 if(target.connectionId!==undefined)return /^(instagram|facebook)_\d{1,128}$/.test(target.connectionId)?target.connectionId:'';
 try{return socialConnectionId(target.channel,target.accountId);}catch{return '';}
}
export function legacyBusinessConnections(snapshot:{drafts?:ContentDraft[]}):string[] {
  return [...new Set((snapshot.drafts||[]).filter(draft=>!draft.businessId||draft.businessId===PRIMARY_BUSINESS).flatMap(draft=>(draft.publishTargets||[]).map(businessTargetId).filter(Boolean)))].slice(0,50);
}
export function buildBusinessContexts(workspaceId:string,snapshot:{brand:BrandProfile;drafts?:ContentDraft[]},records:{id:string;revision?:number;brand?:BrandProfile;connectionIds?:string[];schedule?:BusinessSchedule}[]):BusinessContext[] {
  if(!snapshot?.brand||snapshot.brand.workspaceId!==workspaceId||!snapshot.brand.businessName)throw new Error('Profil workspace belum tersedia.');
  if(records.length>50)throw new Error('Terlalu banyak profil bisnis.');
  const primary=records.find(item=>item.id===PRIMARY_BUSINESS);
  const fallback:BusinessSchedule={connectionIds:[],timesWib:['08:00','19:00'],days:[...BUSINESS_DAYS]};
  const result:BusinessContext[]=[{id:PRIMARY_BUSINESS,revision:primary?.revision||0,brand:snapshot.brand,connectionIds:primary?.connectionIds||legacyBusinessConnections(snapshot),schedule:primary?.schedule||fallback}];
  for(const record of records.filter(item=>item.id!==PRIMARY_BUSINESS)){
    if(businessId(record.id)!==record.id||!record.brand||record.brand.workspaceId!==workspaceId||record.brand.businessId!==record.id)throw new Error('Profil bisnis tersimpan tidak valid.');
    result.push({id:record.id,revision:record.revision||0,brand:record.brand,connectionIds:record.connectionIds||[],schedule:record.schedule||fallback});
  }
  const assigned=new Set<string>();
  for(const item of result){if(!Number.isSafeInteger(item.revision)||item.revision<0||item.connectionIds.length>50)throw new Error('Profil bisnis tersimpan tidak valid.');for(const id of item.connectionIds){if(!/^(instagram|facebook)_\d{1,128}$/.test(id)||assigned.has(id))throw new Error('Akun sosial tidak boleh ditautkan ke dua bisnis.');assigned.add(id);}}
  return result;
}
export function getBusiness(contexts:BusinessContext[],id:unknown):BusinessContext {
  const found=contexts.find(item=>item.id===businessId(id));if(!found)throw new Error('Bisnis tidak ditemukan. Muat ulang daftar bisnis.');return found;
}
export function assertBusinessTargets(contexts:BusinessContext[],id:string,ids:string[],legacy=false) {
  const context=getBusiness(contexts,id);
  for(const target of ids){const assigned=contexts.find(item=>item.connectionIds.includes(target));if(assigned?.id!==context.id&&!(legacy&&context.id===PRIMARY_BUSINESS&&!assigned))throw new Error('Akun tujuan belum ditautkan ke bisnis ini. Periksa pilihan bisnis dan akun sosial.');}
}
export function assetBusiness(asset:Pick<BrandVaultAsset,'businessId'>):string {return asset.businessId||PRIMARY_BUSINESS;}
export function draftBusiness(draft:Pick<ContentDraft,'businessId'>):string {return draft.businessId||PRIMARY_BUSINESS;}
export function businessAccounts(context:BusinessContext,accounts:ChannelConnectionState[]):ChannelConnectionState[] {return accounts.filter(item=>item.connectionId&&context.connectionIds.includes(item.connectionId));}
