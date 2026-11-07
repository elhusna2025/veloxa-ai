import { uploadBrandPhoto, listBrandPhotos } from '@/lib/server/content';
import { errorResponse, noStoreJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { return noStoreJson({ ok: true, asset: await uploadBrandPhoto(request) }); }
  catch (error) { return errorResponse(error); }
}
export async function GET(request: Request) {
  try { return noStoreJson({ ok: true, assets: await listBrandPhotos(request, new URL(request.url).searchParams.get('workspaceId')) }); }
  catch (error) { return errorResponse(error); }
}
