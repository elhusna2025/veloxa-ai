import { youtubeUploadGet } from '@/lib/server/youtube-upload-jobs';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return youtubeUploadGet(request, (await params).id);
}
