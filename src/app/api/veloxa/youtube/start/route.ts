import { startYouTube } from '@/lib/server/youtube-oauth';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return startYouTube(request);
}
