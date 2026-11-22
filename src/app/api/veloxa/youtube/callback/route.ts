import { youtubeCallback } from '@/lib/server/youtube-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return youtubeCallback(request);
}
