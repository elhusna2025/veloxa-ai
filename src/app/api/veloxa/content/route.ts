import { createSocialContent, listSocialContent } from '@/lib/server/content';
import { streamContentGeneration } from '@/lib/server/content-generation-stream';
import { errorResponse, noStoreJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  if (request.headers.get('Accept')?.includes('application/x-ndjson')) return streamContentGeneration(onProgress => createSocialContent(request, { onProgress }));
  try { return noStoreJson({ ok: true, ...await createSocialContent(request) }); }
  catch (error) { return errorResponse(error); }
}
export async function GET(request: Request) {
  try { return noStoreJson({ ok: true, ...await listSocialContent(request, new URL(request.url).searchParams.get('workspaceId')) }); }
  catch (error) { return errorResponse(error); }
}
