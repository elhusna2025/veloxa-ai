import {prepareContentOperation} from '@/lib/server/content-operation';
import { createSocialContent, listSocialContent } from '@/lib/server/content';
import { streamContentGeneration } from '@/lib/server/content-generation-stream';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  if (request.headers.get('Accept')?.includes('application/x-ndjson')) {
    try {const body=await readJson(request.clone());if(body.operationId){const operation=await prepareContentOperation(request);if(!operation.start)return noStoreJson({operationId:operation.operationId,pending:true},202);return streamContentGeneration(operation.run,operation.operationId);}return streamContentGeneration(onProgress=>createSocialContent(request,{onProgress}));}
    catch(error){return errorResponse(error);}
  }
  try { return noStoreJson({ ok: true, ...await createSocialContent(request) }); }
  catch (error) { return errorResponse(error); }
}
export async function GET(request: Request) {
  try { return noStoreJson({ ok: true, ...await listSocialContent(request, new URL(request.url).searchParams.get('workspaceId')) }); }
  catch (error) { return errorResponse(error); }
}
