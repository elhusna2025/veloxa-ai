import { dispatchYouTubeCallback } from '@/lib/server/youtube-upload-permission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return dispatchYouTubeCallback(request);
}
