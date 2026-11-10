import {readContentOperation} from '@/lib/server/content-operation';
import {errorResponse,noStoreJson} from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){try{const query=new URL(request.url).searchParams;return noStoreJson(await readContentOperation(request,query.get('workspaceId'),query.get('businessId'),query.get('operationId'),{expectedInputFingerprint:query.get('inputFingerprint')}));}catch(error){return errorResponse(error);}}
