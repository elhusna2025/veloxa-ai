import { analyzeBrandLogo } from '@/lib/server/brand-palette';
import { errorResponse, noStoreJson } from '@/lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request) { try { return noStoreJson({ok:true,...await analyzeBrandLogo(request)}); } catch(error) { return errorResponse(error); } }
