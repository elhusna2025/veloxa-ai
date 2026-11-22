import { youtubeProductionApi } from '@/lib/server/youtube-production-jobs';
export const runtime = 'nodejs';
export const maxDuration = 300;
export function GET(request: Request) { return youtubeProductionApi(request); }
export function POST(request: Request) { return youtubeProductionApi(request); }
