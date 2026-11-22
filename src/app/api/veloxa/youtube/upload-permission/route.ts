import { confirmYouTubeUploadPermission, getYouTubeUploadPermission } from '@/lib/server/youtube-upload-permission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return getYouTubeUploadPermission(request);
}

export function POST(request: Request) {
  return confirmYouTubeUploadPermission(request);
}
