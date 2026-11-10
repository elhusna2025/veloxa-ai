import { disconnectInstagram, selectInstagramAccount } from '@/lib/server/instagram-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { disconnectSocialAccount } from '@/lib/server/social-connections';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const body = await readJson(request); return noStoreJson({ ok: true, ...await selectInstagramAccount(request, body.workspaceId, body.accountId) }); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { const body=await readJson(request); await disconnectSocialAccount(request,body.workspaceId,body.connectionId); return noStoreJson({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
