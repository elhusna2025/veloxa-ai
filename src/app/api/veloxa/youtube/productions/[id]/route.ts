import { youtubeProductionApi } from '@/lib/server/youtube-production-jobs';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return youtubeProductionApi(request, (await context.params).id); }
export async function POST(request: Request, context: Context) { return youtubeProductionApi(request, (await context.params).id); }
