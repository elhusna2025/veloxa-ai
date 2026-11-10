import { listBusinesses, createBusiness, updateBusiness } from '@/lib/server/business-contexts';
import { errorResponse, noStoreJson } from '@/lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request){try{return noStoreJson({ok:true,...await listBusinesses(request,new URL(request.url).searchParams.get('workspaceId'))});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{return noStoreJson({ok:true,...await createBusiness(request)});}catch(error){return errorResponse(error);}}
export async function PATCH(request:Request){try{return noStoreJson({ok:true,...await updateBusiness(request)});}catch(error){return errorResponse(error);}}
