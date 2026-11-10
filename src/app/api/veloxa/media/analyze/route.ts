import {analyzeAssetKind} from '@/lib/server/asset-kind';
import {errorResponse,noStoreJson} from '@/lib/server/http';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){try{return noStoreJson({suggestion:await analyzeAssetKind(request)});}catch(error){return errorResponse(error);}}
