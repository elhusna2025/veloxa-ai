import { youtubeProductionPreview } from '@/lib/server/youtube-production-preview';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return youtubeProductionPreview(request, (await context.params).id); }
export const HEAD = GET;
export const POST = GET;
