import {createHash} from 'node:crypto';
import {jsonFingerprint} from '../profile-fingerprint';
import {z} from 'zod';
import {requireWorkspace,hasWorkspaceAccess} from './auth';
import {isVerifiedAdmin} from '../veloxa-workspace-policy';
import {businessId} from '../business-context';
import {resolveBusinessContext} from './business-contexts';
import {ApiError,errorResponse,readJson} from './http';
import {GenerationStageError} from './content-generation-stream';
import type {GenerationProgress} from '../content-generation';
import {createSocialContent,contentInput} from './content';
const uuid=z.string().uuid();
export async function prepareContentOperation(request:Request,deps:{authorize?:typeof requireWorkspace;create?:typeof createSocialContent}={}){
 const body=await readJson(request.clone()) as Record<string,unknown>;contentInput.parse(body);const operationId=uuid.parse(body.operationId);const id=businessId(body.businessId);const {ref,workspace,user}=await(deps.authorize||requireWorkspace)(request,body.workspaceId);await resolveBusinessContext(ref,workspace,id);const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');const job=ref.collection('generation_jobs').doc(operationId);const {operationId:omitted,...originalInput}=body;const inputFingerprint=await jsonFingerprint(originalInput);
 const start=await ref.firestore.runTransaction(async tx=>{const ws=(await tx.get(ref)).data();if(!ws||!hasWorkspaceAccess(user.uid,ws,isVerifiedAdmin(user)))throw new ApiError(403,'Akses workspace berubah.');const existing=(await tx.get(job)).data();if(existing){if(existing.requestHash!==hash||existing.businessId!==id||existing.createdBy!==user.uid)throw new ApiError(409,'Identitas proses digunakan oleh permintaan lain.');return false;}tx.create(job,{businessId:id,createdBy:user.uid,requestHash:hash,inputFingerprint,state:'running',stage:'validation',startedAt:Date.now(),updatedAt:Date.now()});return true;});
 return{operationId,start,run:async(report:(progress:GenerationProgress)=>void)=>{
  let writes=Promise.resolve();let stage:GenerationProgress['stage']='validation';let saved:Awaited<ReturnType<typeof createSocialContent>>|undefined;
  try{saved=await(deps.create||createSocialContent)(request,{onProgress:event=>{stage=event.stage;report(event);writes=writes.then(()=>job.update({stage:event.stage,updatedAt:Date.now()}).then(()=>{})).catch(()=>{});}});await writes;await job.update({state:'complete',stage:'saving',updatedAt:Date.now(),draftId:saved.draft.id,engineMode:saved.engineMode,...(saved.generationQuota?{generationQuota:saved.generationQuota}:{})});return saved;}
  catch(error){await writes;const failedStage=error instanceof GenerationStageError?error.stage:stage;const safe=await errorResponse(error).json();await job.update({state:saved||failedStage==='saving'?'uncertain':'failed',stage:failedStage,error:safe.error,code:safe.code,updatedAt:Date.now(),...(saved?{draftId:saved.draft.id}:{})}).catch(()=>{});throw error instanceof GenerationStageError?error:new GenerationStageError(error,saved?'saving':stage);}
 }};
}
export async function readContentOperation(request:Request,workspaceId:unknown,rawBusinessId:unknown,rawOperationId:unknown,deps:{authorize?:typeof requireWorkspace;expectedInputFingerprint?:string|null}={}){
 const operationId=uuid.parse(rawOperationId);const id=businessId(rawBusinessId);const {ref,workspace,user}=await(deps.authorize||requireWorkspace)(request,workspaceId);await resolveBusinessContext(ref,workspace,id);const record=(await ref.collection('generation_jobs').doc(operationId).get()).data();if(!record||record.businessId!==id)throw new ApiError(404,'Proses belum tercatat pada bisnis ini.');if(deps.expectedInputFingerprint&&(!/^[a-f0-9]{64}$/.test(deps.expectedInputFingerprint)||record.inputFingerprint!==deps.expectedInputFingerprint))throw new ApiError(409,'Hasil ini berasal dari permintaan berbeda. Periksa proses sebelumnya secara terpisah.');if(record.createdBy!==user.uid&&workspace.ownerUid!==user.uid&&!isVerifiedAdmin(user))throw new ApiError(403,'Proses ini milik pengguna lain.');
 let stored=record.draftId?(await ref.collection('social_drafts').doc(record.draftId).get()).data():undefined;
 if(!stored&&(record.state==='running'||record.state==='uncertain'))stored=(await ref.collection('social_drafts').where('operationId','==',operationId).limit(1).get()).docs[0]?.data();
 if(stored?.draft?.workspaceId===ref.id&&(stored.draft.businessId||'primary')===id&&stored.operationId===operationId&&stored.draft.renderedMedia?.url)return{state:'complete',stage:'saving',result:{draft:stored.draft,engineMode:stored.engineMode,...(record.generationQuota?{generationQuota:record.generationQuota}:{})}};
 if(record.state==='complete'||record.state==='uncertain'||Date.now()-record.updatedAt>10*60000)return{state:'uncertain',stage:record.stage,error:'Hasil proses perlu diperiksa. Muat ulang koleksi konten sebelum membuat ulang.',operationId};
 return{state:record.state,stage:record.stage,error:record.error,operationId};
}
