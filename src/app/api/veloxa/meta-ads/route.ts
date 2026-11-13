import { z } from 'zod';
import { workspaceIdSchema } from '@/lib/server/auth';
import { errorResponse, noStoreJson, readJson } from '@/lib/server/http';
import { getMetaAds, mutateMetaAds } from '@/lib/server/meta-ads';
import { disconnectMetaAds } from '@/lib/server/meta-oauth';

const disconnectInput = z.object({ workspaceId: workspaceIdSchema }).strict();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(request: Request) {
  try { return noStoreJson(await getMetaAds(request)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return noStoreJson(await mutateMetaAds(request)); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = disconnectInput.parse(await readJson(request));
    return noStoreJson(await disconnectMetaAds(request, workspaceId));
  } catch (error) { return errorResponse(error); }
}
