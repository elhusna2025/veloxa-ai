import {assertNoAutonomyDispatch} from './autonomy-dispatch';
import { randomUUID } from 'node:crypto';
import { BUSINESS_CATEGORIES } from '../business-categories';
import { profileFingerprint } from '../profile-fingerprint';
import { isWorkspacePhoto } from './brand-assets';
import { assetBusiness } from '../business-context';
import { z } from 'zod';
import { requireWorkspace, hasWorkspaceAccess } from './auth';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { readJson, ApiError } from './http';
import { readSocialAccounts } from './social-accounts';
import { normalizeBrandProfile } from '../veloxa-brand-profile';
import { blankBusinessProfile, buildBusinessContexts, businessId, getBusiness, PRIMARY_BUSINESS, BUSINESS_DAYS, type BusinessContext } from '../business-context';
import type { BrandProfile, ContentDraft } from '../veloxa-types';
type Ref=Awaited<ReturnType<typeof requireWorkspace>>['ref'];
type Tx=FirebaseFirestore.Transaction;
export async function loadBusinessContexts(ref:Ref,workspace:Record<string,unknown>,tx?:Tx):Promise<BusinessContext[]> {
  const query=ref.collection('business_contexts');const docs=await(tx?tx.get(query):query.get());
  try {const snapshot=JSON.parse(String(workspace.snapshotJson));return buildBusinessContexts(ref.id,snapshot,docs.docs.map(doc=>({...doc.data(),id:doc.id})));}
  catch {throw new ApiError(409,'Daftar bisnis belum valid. Muat ulang atau periksa profil workspace.','business_context_invalid');}
}
export async function resolveBusinessContext(ref:Ref,workspace:Record<string,unknown>,rawId:unknown,tx?:Tx) {
  const contexts=await loadBusinessContexts(ref,workspace,tx);
  try{return{contexts,context:getBusiness(contexts,rawId)};}catch(error){throw new ApiError(409,error instanceof Error?error.message:'Bisnis tidak ditemukan.','business_context_invalid');}
}
export async function listBusinesses(request:Request,workspaceId:unknown){const {ref,workspace}=await requireWorkspace(request,workspaceId);return{businesses:await loadBusinessContexts(ref,workspace)};}
const ids=z.array(z.string().regex(/^(instagram|facebook)_\d{1,128}$/)).max(50).refine(value=>new Set(value).size===value.length);
const schedule=z.object({connectionIds:ids,timesWib:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4).refine(value=>new Set(value).size===value.length),days:z.array(z.enum(BUSINESS_DAYS)).min(1).max(7).refine(value=>new Set(value).size===value.length)}).strict();
const createInput=z.object({workspaceId:z.string(),name:z.string().trim().min(1).max(110)}).strict();
const updateInput=z.object({workspaceId:z.string(),businessId:z.string().regex(/^(primary|b_[a-f0-9-]{36})$/),expectedRevision:z.number().int().nonnegative(),expectedProfileFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),connectionIds:ids.optional(),profile:z.unknown().optional(),schedule:schedule.optional()}).strict();
function profileInput(raw:unknown,workspaceId:string,id:string):BrandProfile {
  try{
    if(!raw||typeof raw!=='object'||JSON.stringify(raw).length>25000)throw new Error();
    const base=blankBusinessProfile(workspaceId,id,'');const allowed=Object.fromEntries(Object.keys(base).concat(['logoAssetId','useBrandPalette','additionalColorHexes']).filter(key=>key in raw).map(key=>[key,(raw as Record<string,unknown>)[key]]));
    const candidate={...base,...allowed,workspaceId,businessId:id} as BrandProfile;
    for(const key of ['businessName','businessDescription','city','targetAudience','brandTone','primaryColorHex','accentColorHex','visualVibe','defaultCta','whatsappNumber','websiteUrl'] as const)if(typeof candidate[key]!=='string')throw new Error('Isian profil bisnis tidak valid.');
    if(!BUSINESS_CATEGORIES.some(item=>item.value===candidate.category))throw new Error('Bidang bisnis tidak valid.');
    if(!Array.isArray(candidate.offerings)||candidate.offerings.length>30||!Array.isArray(candidate.forbiddenWords)||candidate.forbiddenWords.length>100||candidate.forbiddenWords.some(word=>typeof word!=='string'||word.length>200)||typeof candidate.prioritizeRealAssets!=='boolean')throw new Error();
    for(const item of candidate.offerings){if(!item||typeof item.id!=='string'||typeof item.title!=='string'||typeof item.highlight!=='string'||typeof item.priceLabel!=='string'||!['product','event','promo','service'].includes(item.category))throw new Error();}
    const result=normalizeBrandProfile(candidate);if(id===PRIMARY_BUSINESS)delete result.businessId;return result;
  }catch(error){throw new ApiError(400,error instanceof Error&&error.message?error.message:'Profil bisnis tidak valid.','invalid_business_profile');}
}
function assertOwner(workspace:Record<string,unknown>|undefined,user:Awaited<ReturnType<typeof requireWorkspace>>['user']){if(!workspace||(!isVerifiedAdmin(user)&&workspace.ownerUid!==user.uid))throw new ApiError(403,'Pemilik workspace telah berubah.','forbidden');}
export async function createBusiness(request:Request,dependencies:{authorize?:typeof requireWorkspace}={}){
  const input=createInput.parse(await readJson(request));const {ref,user}=await(dependencies.authorize||requireWorkspace)(request,input.workspaceId,true);const id='b_'+randomUUID();
  const businesses=await ref.firestore.runTransaction(async tx=>{const ws=(await tx.get(ref)).data();assertOwner(ws,user);const contexts=await loadBusinessContexts(ref,ws!,tx);if(contexts.length>=50)throw new ApiError(409,'Maksimal 50 bisnis per workspace.');
    const context:BusinessContext={id,revision:1,brand:blankBusinessProfile(ref.id,id,input.name),connectionIds:[],schedule:{connectionIds:[],timesWib:['08:00','19:00'],days:[...BUSINESS_DAYS]}};
    tx.create(ref.collection('business_contexts').doc(id),{...context,createdBy:user.uid,createdAt:Date.now(),updatedAt:Date.now()});return[...contexts,context];});return{businesses,businessId:id};
}
export async function updateBusiness(request:Request,dependencies:{authorize?:typeof requireWorkspace}={}){
 const input=updateInput.parse(await readJson(request));const id=businessId(input.businessId);const {ref,user}=await(dependencies.authorize||requireWorkspace)(request,input.workspaceId,true);
 const result=await ref.firestore.runTransaction(async tx=>{await assertNoAutonomyDispatch(tx,ref);const ws=(await tx.get(ref)).data();assertOwner(ws,user);const contexts=await loadBusinessContexts(ref,ws!,tx);const accounts=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);
  let current:BusinessContext;try{current=getBusiness(contexts,id);}catch{throw new ApiError(404,'Bisnis tidak ditemukan.');}
  if(current.revision!==input.expectedRevision)throw new ApiError(409,'Bisnis telah diubah pada tab lain. Muat ulang sebelum menyimpan.','business_conflict');
  if(id===PRIMARY_BUSINESS&&input.profile!==undefined&&input.expectedProfileFingerprint!==await profileFingerprint(current.brand))throw new ApiError(409,'Profil bisnis utama telah berubah. Muat ulang sebelum menyimpan.','profile_conflict');
  const connectionIds=input.connectionIds||current.connectionIds;
  if(input.connectionIds&&connectionIds.some(key=>!current.connectionIds.includes(key)&&!accounts.some(account=>account.connectionId===key)))throw new ApiError(409,'Salah satu akun belum terhubung ke workspace. Muat ulang daftar akun.');
  if(connectionIds.some(key=>contexts.some(other=>other.id!==id&&other.connectionIds.includes(key))))throw new ApiError(409,'Akun masih ditautkan ke bisnis lain. Lepaskan dari bisnis tersebut sebelum memindahkan.','business_assignment_conflict');
  const plan=input.schedule||{...current.schedule,connectionIds:current.schedule.connectionIds.filter(key=>connectionIds.includes(key))};
  if(plan.connectionIds.some(key=>!connectionIds.includes(key)))throw new ApiError(400,'Akun jadwal harus ditautkan ke bisnis ini.');
  const next={...current,revision:current.revision+1,connectionIds,schedule:plan,...(input.profile!==undefined?{brand:profileInput(input.profile,ref.id,id)}:{})};
  if(input.profile!==undefined&&next.brand.logoAssetId){const logoId=z.string().uuid().parse(next.brand.logoAssetId);const logo=(await tx.get(ref.collection('server_assets').doc(logoId))).data();if(!isWorkspacePhoto(logo,ref.id)||logo.asset.id!==logoId||logo.trashedAt||assetBusiness(logo.asset)!==id)throw new ApiError(409,'Logo tidak tersedia pada bisnis ini. Pilih logo milik bisnis ini atau kosongkan pilihan logo.','business_logo_mismatch');}
  let workspaceSnapshotRevision:number|undefined;
  if(id===PRIMARY_BUSINESS&&input.profile!==undefined){const snapshot=JSON.parse(String(ws!.snapshotJson));const revision=Number(ws!.snapshotRevision||0);if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw new ApiError(409,'Revisi workspace tidak valid.');workspaceSnapshotRevision=revision+1;const now=new Date().toISOString();const snapshotJson=JSON.stringify({...snapshot,brand:next.brand,updatedAtIso:now});if(snapshotJson.length>480000)throw new ApiError(413,'Workspace terlalu besar untuk disimpan.');tx.update(ref,{snapshotJson,snapshotRevision:workspaceSnapshotRevision,name:next.brand.businessName,category:next.brand.category,city:next.brand.city.slice(0,80),targetAudience:next.brand.targetAudience.slice(0,500),toneOfVoice:next.brand.brandTone.slice(0,250),updatedAt:now});}
  const record={...next,updatedAt:Date.now(),updatedBy:user.uid};if(id===PRIMARY_BUSINESS)delete (record as Partial<typeof record>).brand;
  tx.set(ref.collection('business_contexts').doc(id),record);return{businesses:contexts.map(item=>item.id===id?next:item),...(workspaceSnapshotRevision===undefined?{}:{workspaceSnapshotRevision})};
 });return result;
}
