import {ContentGenerationError,isGenerationStage,type GenerationProgress} from './content-generation';
export interface OperationState<T>{state:'running'|'complete'|'failed'|'uncertain';stage?:unknown;result?:T;error?:string}
/** Poll the same operation after a stream disconnect. Never POST a replacement generation. */
export async function recoverGeneration<T>(operationId:string,read:()=>Promise<OperationState<T>>,progress:(value:GenerationProgress)=>void,deps:{sleep?:(ms:number)=>Promise<void>;now?:()=>number;timeout?:number}={}):Promise<T>{
 const now=deps.now||Date.now;const deadline=now()+(deps.timeout||6*60000);let stage:GenerationProgress['stage']|undefined;
 do{let value:OperationState<T>;try{value=await read();}catch(error){if(error instanceof ContentGenerationError&&!error.uncertain)throw error;if(now()>=deadline)break;await(deps.sleep||sleep)(3000);continue;}
 if(isGenerationStage(value.stage)){stage=value.stage;progress({stage});}if(value.state==='complete'&&value.result)return value.result;if(value.state==='failed')throw new ContentGenerationError(value.error||'Konten belum berhasil dibuat.',stage,operationId,false);if(value.state==='uncertain')throw new ContentGenerationError(value.error||'Hasil perlu diperiksa pada koleksi konten.',stage,operationId,true);await(deps.sleep||sleep)(3000);
 }while(now()<deadline);
 throw new ContentGenerationError('Pemeriksaan hasil belum selesai. Periksa koleksi konten atau tekan Buat draf untuk memeriksa percobaan yang sama.',stage,operationId,true);
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
