import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {requireWorkspace,workspaceIdSchema} from './auth';
import {isVerifiedAdmin} from '../veloxa-workspace-policy';
import {businessId} from '../business-context';
import {profileFingerprint} from '../profile-fingerprint';
import {resolveBusinessContext} from './business-contexts';
import {connectionIdSchema,readSocialAccounts,type StoredAccount} from './social-accounts';
import {decryptMetaToken} from './meta-crypto';
import {ApiError,readJson} from './http';
import {collectSocialEvidence} from './brand-social-sources';
import {loadContentReferences} from './content-references';
import {suggestBrandProfile} from './brand-analysis-agent';
import type {AnalysisStage,BrandAnalysis} from '../brand-analysis';
const input=z.object({workspaceId:workspaceIdSchema,businessId:z.string(),profileFingerprint:z.string().regex(/^[a-f0-9]{64}$/),connectionIds:z.array(connectionIdSchema).min(1).max(10).refine(ids=>new Set(ids).size===ids.length)}).strict();
export async function analyzeSocialBrand(request:Request,deps:{authorize?:typeof requireWorkspace;collect?:typeof collectSocialEvidence;suggest?:typeof suggestBrandProfile;references?:typeof loadContentReferences;decrypt?:typeof decryptMetaToken;progress?:(stage:AnalysisStage)=>void}={}):Promise<BrandAnalysis>{
 const body=input.parse(await readJson(request));const id=businessId(body.businessId);const {ref,user}=await(deps.authorize||requireWorkspace)(request,body.workspaceId,true);const lease=ref.collection('profile_analysis_jobs').doc(id);const runId=randomUUID();let baseline:StoredAccount[]|undefined;
 const check=async(tx:FirebaseFirestore.Transaction)=>{
  const workspace=(await tx.get(ref)).data();if(!workspace||!isVerifiedAdmin(user)&&workspace.ownerUid!==user.uid)throw new ApiError(403,'Akses pemilik workspace telah berubah.');
  const {context}=await resolveBusinessContext(ref,workspace,id,tx);if(await profileFingerprint(context.brand)!==body.profileFingerprint)throw new ApiError(409,'Profil telah berubah. Muat ulang sebelum menganalisis.');
  const records=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);const accounts=body.connectionIds.map(key=>{const found=records.find(account=>account.connectionId===key);if(!context.connectionIds.includes(key)||!found||found.expiresAt&&found.expiresAt<=Date.now())throw new ApiError(409,'Salah satu akun belum terhubung pada bisnis ini. Muat ulang atau hubungkan ulang akun.');return found;});
  if(baseline&&accounts.some((account,index)=>account.encryptedToken!==baseline![index].encryptedToken||account.loginProvider!==baseline![index].loginProvider))throw new ApiError(409,'Koneksi akun telah berubah. Analisis perlu diulang.');
  return {context,accounts};
 };
 deps.progress?.('validation');
 const {context,accounts}=await ref.firestore.runTransaction(async tx=>{const current=await check(tx);const job=(await tx.get(lease)).data();if(job?.expiresAt>Date.now())throw new ApiError(409,'Analisis bisnis ini masih berjalan. Tunggu hingga selesai.');tx.set(lease,{runId,expiresAt:Date.now()+300000});return current;});baseline=accounts;
 try{
  deps.progress?.('profiles');const evidence=await(deps.collect||collectSocialEvidence)(accounts,account=>(deps.decrypt||decryptMetaToken)(account.encryptedToken,ref.id),{progress:()=>deps.progress?.('visuals')});
  if(context.brand.logoAssetId){try{const [logo]=await(deps.references||loadContentReferences)(ref,ref.id,[context.brand.logoAssetId],undefined,id);evidence.sources.push({id:'uploaded_logo',kind:'logo',label:'Logo pada DNA visual',text:logo.title});evidence.images=[{sourceId:'uploaded_logo',avatar:true,bytes:logo.bytes},...evidence.images].slice(0,6);}catch{evidence.warnings.push('File logo tersimpan belum dapat dibaca; tidak dipakai dalam analisis.');}}
  const sampledImages=new Set(evidence.images.map(image=>image.sourceId));
  evidence.sources=evidence.sources.filter(source=>source.kind!=='post'||source.text.trim()||sampledImages.has(source.id));
  if(!evidence.sources.some(source=>source.kind==='profile'||source.kind==='post'))throw new ApiError(422,'Profil dan postingan belum dapat dibaca dari Meta. Periksa izin akun atau lengkapi profil secara manual.');
  await ref.firestore.runTransaction(check);deps.progress?.('suggestions');
  const savedOfferings=context.brand.offerings.map(({title,category})=>({title,category}));
  const proposal=await(deps.suggest||suggestBrandProfile)(evidence,savedOfferings);
  deps.progress?.('review');await ref.firestore.runTransaction(check);
  return {workspaceId:ref.id,businessId:id,baseFingerprint:body.profileFingerprint,sources:evidence.sources,suggestions:proposal.suggestions,warnings:[...new Set([...evidence.warnings,...proposal.warnings])]};
 }finally{await ref.firestore.runTransaction(async tx=>{if((await tx.get(lease)).data()?.runId===runId)tx.delete(lease);}).catch(()=>{/* Lease expires; never mask the result or emit credentials. */});}
}
