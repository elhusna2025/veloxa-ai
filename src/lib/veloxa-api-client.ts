import { ContentGenerationError, readGenerationStream, type GenerationProgress } from './content-generation';
import {jsonFingerprint} from './profile-fingerprint';
import {recoverGeneration,type OperationState} from './generation-recovery';
import {readBrandAnalysisStream,type AnalysisStage,type BrandAnalysis} from './brand-analysis';
import { getFirebaseAuthInstance } from './veloxa-auth';

/** Only send Firebase credentials to our own API, never to arbitrary URLs. */
async function signedVeloxaFetch(path: string, init: RequestInit = {}, feedback?: { onProgress: (progress: GenerationProgress) => void }): Promise<Response> {
  if (!path.startsWith('/api/veloxa/')) throw new Error('Alamat layanan Veloxa tidak valid.');
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Firebase belum dikonfigurasi.');
  await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Silakan masuk ke akun Anda.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  if (feedback) headers.set('Accept', 'application/x-ndjson');
  return fetch(path, { ...init, headers, cache: 'no-store' });
}

export async function veloxaApi<T>(path: string, init: RequestInit = {}, feedback?: { onProgress: (progress: GenerationProgress) => void }): Promise<T> {
  const response = await signedVeloxaFetch(path, init, feedback);
  if (response.ok && feedback && response.headers.get('Content-Type')?.includes('application/x-ndjson')) return readGenerationStream<T>(response, feedback.onProgress);
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('API Veloxa belum aktif pada domain ini. Periksa deployment server.');
  const data = await response.json();
  if (!response.ok) { const message = data.error || 'Permintaan belum berhasil. Silakan coba lagi.'; if (feedback) throw new ContentGenerationError(message); throw new Error(message); }
  return data as T;
}

/** Resume only the matching request, or an explicitly requested earlier operation. */
export async function createVeloxaContent<T>(body:{workspaceId:string;businessId:string;[key:string]:unknown},feedback:{onProgress:(value:GenerationProgress)=>void;onRecover:()=>void;resumePrevious?:boolean}):Promise<T>{
 const auth=getFirebaseAuthInstance();if(!auth)throw new ContentGenerationError('Firebase belum dikonfigurasi.');await auth.authStateReady();if(!auth.currentUser)throw new ContentGenerationError('Silakan masuk.');
 const key=`veloxa:generation:${auth.currentUser.uid}:${body.workspaceId}:${body.businessId}`;const fingerprint=await jsonFingerprint(body);let previous:{id:string;fingerprint:string}|undefined;
 try{const value=JSON.parse(sessionStorage.getItem(key)||'null');if(value&&/^[a-f0-9-]{36}$/.test(value.id)&&/^[a-f0-9]{64}$/.test(value.fingerprint))previous=value;}catch{/* Optional storage. */}
 if(previous&&previous.fingerprint!==fingerprint&&!feedback.resumePrevious)throw new ContentGenerationError('Ada proses sebelumnya dengan topik, format, atau referensi berbeda. Tekan Periksa proses sebelumnya terlebih dahulu; permintaan baru ini belum dijalankan.',undefined,previous.id,true);
 if(feedback.resumePrevious&&!previous)throw new ContentGenerationError('Tidak ada proses sebelumnya yang menunggu. Anda dapat membuat draf baru.');
 const operationId=previous?.id||crypto.randomUUID();const expected=previous?.fingerprint||fingerprint;
 const read=async()=>{const response=await signedVeloxaFetch(`/api/veloxa/generation?workspaceId=${encodeURIComponent(body.workspaceId)}&businessId=${encodeURIComponent(body.businessId)}&operationId=${operationId}&inputFingerprint=${expected}`,{signal:AbortSignal.timeout(15000)});const value=await response.json().catch(()=>({}));if([400,401,403,409].includes(response.status))throw new ContentGenerationError(value.error||'Akses proses ditolak.',undefined,operationId,false);if(!response.ok)throw new ContentGenerationError('Status proses belum tersedia. Pemeriksaan akan dicoba kembali untuk percobaan yang sama.',undefined,operationId,true);return value as OperationState<T>;};
 const clear=()=>{try{const stored=JSON.parse(sessionStorage.getItem(key)||'null');if(stored?.id===operationId)sessionStorage.removeItem(key);}catch{/* Optional storage. */}};
 try{
  if(!previous){try{sessionStorage.setItem(key,JSON.stringify({id:operationId,fingerprint}));}catch{/* Optional storage. */}let response:Response|undefined;try{response=await signedVeloxaFetch('/api/veloxa/content',{method:'POST',body:JSON.stringify({...body,operationId})},feedback);}catch{/* Inspect the same operation; never send a replacement POST. */}
   if(response?.ok&&response.headers.get('Content-Type')?.includes('application/x-ndjson')){try{const result=await readGenerationStream<T>(response,feedback.onProgress);clear();return result;}catch(error){if(!(error instanceof ContentGenerationError)||!error.uncertain)throw error;}}
   else if(response){const data=await response.json().catch(()=>({}));if(!response.ok)throw new ContentGenerationError(data.error||'Konten belum dapat dibuat.',undefined,operationId,false);}
  }
  feedback.onRecover();const result=await recoverGeneration(operationId,read,feedback.onProgress);clear();return result;
 }catch(error){if(error instanceof ContentGenerationError){if(!error.uncertain)clear();throw error;}throw new ContentGenerationError('Pemeriksaan hasil terputus. Identitas percobaan tetap disimpan; gunakan Periksa proses sebelumnya.',undefined,operationId,true);}
}

export async function analyzeVeloxaBrand(body:unknown,onProgress:(stage:AnalysisStage)=>void):Promise<BrandAnalysis>{
 const response=await signedVeloxaFetch('/api/veloxa/brand/analyze',{method:'POST',headers:{Accept:'application/x-ndjson'},body:JSON.stringify(body)});
 if(response.ok&&response.headers.get('Content-Type')?.includes('application/x-ndjson'))return readBrandAnalysisStream(response,onProgress);
 const data=await response.json().catch(()=>({}));throw new Error(data.error||'Analisis profil belum tersedia.');
}

/** Private vault previews keep credentials in headers, never image URLs. */
export async function veloxaApiBlob(path:string, init:RequestInit = {}):Promise<Blob> {
  const response=await signedVeloxaFetch(path,init);
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Foto belum dapat dimuat.');}
  if(!response.headers.get('Content-Type')?.startsWith('image/'))throw new Error('Pratinjau foto tidak valid.');
  return response.blob();
}
