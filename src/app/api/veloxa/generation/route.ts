import {readContentOperation, resumeContentOperation} from '@/lib/server/content-operation';
import {streamContentGeneration} from '@/lib/server/content-generation-stream';
import {errorResponse,noStoreJson} from '@/lib/server/http';
export const runtime='nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const resumed = await resumeContentOperation(request);
    if (resumed.operation?.start) return streamContentGeneration(resumed.operation.run, resumed.operation.operationId);
    return noStoreJson(resumed.status ?? { state: 'running' }, 202);
  } catch (error) { return errorResponse(error); }
}
export async function GET(request:Request){try{const query=new URL(request.url).searchParams;return noStoreJson(await readContentOperation(request,query.get('workspaceId'),query.get('businessId'),query.get('operationId'),{expectedInputFingerprint:query.get('inputFingerprint')}));}catch(error){return errorResponse(error);}}
