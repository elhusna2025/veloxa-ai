import { disconnectMeta, metaAccounts, selectMetaPage } from '@/lib/server/meta-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { disconnectSocialAccount } from '@/lib/server/social-connections';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { return noStoreJson({ ok: true, ...await metaAccounts(request, new URL(request.url).searchParams.get('workspaceId')) }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { const body = await readJson(request); return noStoreJson({ ok: true, ...await selectMetaPage(request, body.workspaceId, body.pageId) }); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { const body=await readJson(request); await disconnectSocialAccount(request,body.workspaceId,body.connectionId); return noStoreJson({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
