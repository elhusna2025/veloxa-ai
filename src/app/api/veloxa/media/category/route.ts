import {updateAssetKind} from '@/lib/server/asset-kind';
import {errorResponse,noStoreJson} from '@/lib/server/http';
export const runtime='nodejs';
export async function PATCH(request:Request){try{return noStoreJson({asset:await updateAssetKind(request)});}catch(error){return errorResponse(error);}}
