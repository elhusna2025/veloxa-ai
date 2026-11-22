import { disconnectYouTube, selectYouTubeConnection } from '@/lib/server/youtube-oauth';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return selectYouTubeConnection(request);
}

export function DELETE(request: Request) {
  return disconnectYouTube(request);
}
