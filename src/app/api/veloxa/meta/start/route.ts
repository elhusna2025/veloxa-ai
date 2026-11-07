import { beginMetaOAuth } from '@/lib/server/meta-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { return noStoreJson({ ok: true, ...await beginMetaOAuth(request, (await readJson(request)).workspaceId) }); }
  catch (error) { return errorResponse(error); }
}
