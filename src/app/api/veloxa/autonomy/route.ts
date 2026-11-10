import{listAutonomy,updateAutonomy}from'@/lib/server/autonomy-api';
import{errorResponse,noStoreJson}from'@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){try{const query=new URL(request.url).searchParams;return noStoreJson(await listAutonomy(request,query.get('workspaceId'),query.get('businessId')));}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request){try{return noStoreJson(await updateAutonomy(request));}catch(error){return errorResponse(error);}}
