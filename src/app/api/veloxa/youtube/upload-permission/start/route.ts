import { startYouTubeUploadPermission } from '@/lib/server/youtube-upload-permission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return startYouTubeUploadPermission(request);
}
