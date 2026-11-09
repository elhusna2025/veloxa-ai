import { disconnectInstagram, selectInstagramAccount } from '@/lib/server/instagram-oauth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const body = await readJson(request); return noStoreJson({ ok: true, ...await selectInstagramAccount(request, body.workspaceId, body.accountId) }); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { await disconnectInstagram(request, (await readJson(request)).workspaceId); return noStoreJson({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
