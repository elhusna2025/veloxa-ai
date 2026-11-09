import { previewWorkspacePhoto } from '@/lib/server/brand-assets';
import { errorResponse } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function GET(request:Request){try{const url=new URL(request.url);return await previewWorkspacePhoto(request,url.searchParams.get('workspaceId'),url.searchParams.get('assetId'));}catch(error){return errorResponse(error);}}
