import { disconnectSocialAccount } from '@/lib/server/social-connections';
import { errorResponse,noStoreJson,readJson } from '@/lib/server/http';
export const runtime='nodejs';
export async function DELETE(request:Request){try{const body=await readJson(request);await disconnectSocialAccount(request,body.workspaceId,body.connectionId);return noStoreJson({ok:true});}catch(error){return errorResponse(error);}}
