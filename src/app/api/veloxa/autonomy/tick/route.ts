import{requireScheduler}from'@/lib/server/autonomy-auth';
import{tickAutonomy}from'@/lib/server/autonomy-worker';
import{errorResponse,noStoreJson}from'@/lib/server/http';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request){try{await requireScheduler(request);return noStoreJson(await tickAutonomy());}catch(error){return errorResponse(error);}}
