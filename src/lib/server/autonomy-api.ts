import {assertNoAutonomyDispatch} from './autonomy-dispatch';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {adminDb} from './firebase';
import {requireWorkspace,workspaceIdSchema} from './auth';
import {ApiError,readJson} from './http';
import {resolveBusinessContext} from './business-contexts';
import {businessId} from '../business-context';
import {profileFingerprint} from '../profile-fingerprint';
import {readSocialAccounts} from './social-accounts';
import {isWorkspacePhoto} from './brand-assets';
import {assetBusiness} from '../business-context';
import {autonomyConfigSchema,nextConfiguredAutonomySlot,validateAutonomySource,type AutoContentRule,type AutoContentStatus} from '../autonomy-rules';
export const ruleKey=(workspaceId:string,id:string)=>createHash('sha256').update(JSON.stringify([workspaceId,id])).digest('hex');
export function ruleCollection(){return adminDb().collection('auto_content_rules');}
export function publicRule(raw:FirebaseFirestore.DocumentData|undefined):AutoContentRule|null{if(!raw)return null;return{revision:raw.revision,enabled:raw.enabled,config:raw.config,nextSlotMs:raw.nextSlotMs,lastError:raw.lastError||'',processingJob:raw.processingJob||null,processingUntil:raw.processingUntil||0,pausePending:!raw.enabled&&!!raw.processingJob,sequence:raw.sequence||0};}
const target=z.object({workspaceId:workspaceIdSchema,businessId:z.string()});
const actionInput=target.extend({expectedRevision:z.number().int().nonnegative(),action:z.enum(['save','activate','pause']),config:autonomyConfigSchema.optional()}).strict();
export async function schedulerHealth() {
 const heartbeat = (await adminDb().collection('system_operations').doc('organic_scheduler').get()).data();
 const lastTickAt = typeof heartbeat?.at === 'number' ? heartbeat.at : null;
 // Older deployments only recorded the start heartbeat.
 const lastCompletedAt = typeof heartbeat?.completedAt === 'number' ? heartbeat.completedAt
  : heartbeat?.tickLeaseId === undefined ? lastTickAt : null;
 const configured = !!process.env.VELOXA_SCHEDULER_EMAIL && !!process.env.VELOXA_SCHEDULER_AUDIENCE;
 return { schedulerReady: configured && lastCompletedAt !== null && Date.now() - lastCompletedAt < 10 * 60_000, lastTickAt };
}
export async function listAutonomy(request:Request,workspaceId:unknown,rawId:unknown):Promise<AutoContentStatus>{const body=target.parse({workspaceId,businessId:rawId});const id=businessId(body.businessId);const{ref,workspace,user}=await requireWorkspace(request,body.workspaceId);await resolveBusinessContext(ref,workspace,id);const ruleRef=ruleCollection().doc(ruleKey(ref.id,id));const [rule,activity,health]=await Promise.all([ruleRef.get(),ruleRef.collection('jobs').orderBy('createdAt','desc').limit(20).get(),schedulerHealth()]);return{rule:publicRule(rule.data()),jobs:activity.docs.map(doc=>({id:doc.id,...doc.data()})) as AutoContentStatus['jobs'],canManage:workspace.ownerUid===user.uid,...health};}
export async function updateAutonomy(request:Request,deps:{authorize?:typeof requireWorkspace;health?:typeof schedulerHealth;database?:ReturnType<typeof adminDb>}={}){
 const input=actionInput.parse(await readJson(request));const id=businessId(input.businessId);const{ref,user}=await(deps.authorize||requireWorkspace)(request,input.workspaceId,true);const db=deps.database||adminDb();const ruleRef=db.collection('auto_content_rules').doc(ruleKey(ref.id,id));
 if(input.action==='activate'&&!(await(deps.health||schedulerHealth)()).schedulerReady)throw new ApiError(503,'Mesin jadwal belum terhubung. Simpan aturan dahulu; aktivasi tersedia setelah penjadwal siap.');
 const result=await db.runTransaction(async tx=>{
  const ws=(await tx.get(ref)).data();if(!ws||ws.ownerUid!==user.uid)throw new ApiError(403,'Hanya pemilik workspace yang dapat mengatur publikasi otomatis.');const{context}=await resolveBusinessContext(ref,ws,id,tx);const stored=(await tx.get(ruleRef)).data();if((stored?.revision||0)!==input.expectedRevision)throw new ApiError(409,'Aturan berubah pada tab lain. Muat ulang terlebih dahulu.');
  if(input.action==='pause'){if(!stored)throw new ApiError(409,'Belum ada aturan tersimpan.');if(stored.pendingJob)tx.update(ruleRef.collection('jobs').doc(stored.pendingJob),{state:'cancelled',retryAt:null,error:'Aturan dijeda; akun yang belum menerima konten tidak dilanjutkan otomatis.',finishedAt:Date.now()});tx.update(ruleRef,{enabled:false,pendingJob:null,revision:stored.revision+1,updatedAt:Date.now()});return{...stored,enabled:false,pendingJob:null,revision:stored.revision+1};}
  await assertNoAutonomyDispatch(tx,ref);
  const config=autonomyConfigSchema.parse(input.action==='save'?input.config:stored?.config);try{validateAutonomySource(config,context.brand);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Sumber konten belum valid.');}
  const accounts=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);for(const key of config.connectionIds){const account=accounts.find(item=>item.connectionId===key);if(!context.connectionIds.includes(key)||!account||account.expiresAt&&account.expiresAt<=Date.now())throw new ApiError(409,'Salah satu akun tidak aktif atau bukan milik bisnis ini.');}
  // Validate every reference before committing or activating; no public URL or profile snapshot writes.
  for(const assetId of config.referenceAssetIds){const asset=(await tx.get(ref.collection('server_assets').doc(assetId))).data();if(!isWorkspacePhoto(asset,ref.id)||asset.asset.id!==assetId||asset.trashedAt||assetBusiness(asset.asset)!==id)throw new ApiError(409,'Salah satu referensi tidak tersedia pada bisnis ini.');}
  if(stored?.processingJob)throw new ApiError(409,'Proses sebelumnya masih berjalan. Jeda dan tunggu hasilnya sebelum mengubah atau mengaktifkan aturan.');
  const now=Date.now();const nextSlotMs=nextConfiguredAutonomySlot(config,now);
  if(nextSlotMs===null)throw new ApiError(400,'Tidak ada slot tersisa hingga tanggal terakhir.');
  const next={...(stored||{}),workspaceId:ref.id,businessId:id,ownerUid:user.uid,config,revision:(stored?.revision||0)+1,enabled:input.action==='activate',profileFingerprint:await profileFingerprint(context.brand),nextSlotMs,nextDueMs:nextSlotMs,sequence:stored?.sequence||0,updatedAt:now,lastError:'',pendingJob:null,processingJob:null,processingUntil:0};tx.set(ruleRef,next);return next;
 });return{rule:publicRule(result)};
}
