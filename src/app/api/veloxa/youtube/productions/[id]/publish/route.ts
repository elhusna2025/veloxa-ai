import { youtubeGeneratedUploadCreate } from '@/lib/server/youtube-upload-jobs';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return youtubeGeneratedUploadCreate(request, (await context.params).id);
}
