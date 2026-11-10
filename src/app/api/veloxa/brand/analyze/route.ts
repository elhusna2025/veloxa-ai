import {analyzeSocialBrand} from '@/lib/server/brand-analysis';
import {ApiError,errorResponse,noStoreJson} from '@/lib/server/http';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){
 if(!request.headers.get('Accept')?.includes('application/x-ndjson')){try{return noStoreJson(await analyzeSocialBrand(request));}catch(error){return errorResponse(error);}}
 const stream=new ReadableStream({async start(controller){const emit=(value:unknown)=>{try{controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));}catch{/* Client left; computation retains its lease and ownership checks. */}};try{const data=await analyzeSocialBrand(request,{progress:stage=>emit({type:'progress',stage})});emit({type:'complete',data});}catch(error){const response=errorResponse(error);const data=await response.json();emit({type:'error',error:data.error,code:error instanceof ApiError?error.code:'analysis_failed'});}finally{try{controller.close();}catch{/* Disconnected client. */}}}});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
}
