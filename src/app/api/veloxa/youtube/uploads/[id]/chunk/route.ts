import { youtubeUploadChunk } from '@/lib/server/youtube-upload-jobs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return youtubeUploadChunk(request, (await params).id);
}
