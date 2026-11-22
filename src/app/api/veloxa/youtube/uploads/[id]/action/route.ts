import { youtubeUploadAction } from '@/lib/server/youtube-upload-jobs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return youtubeUploadAction(request, (await params).id);
}
