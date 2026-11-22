import { youtubeUploadCreate, youtubeUploadsList } from '@/lib/server/youtube-upload-jobs';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return youtubeUploadsList(request);
}

export function POST(request: Request) {
  return youtubeUploadCreate(request);
}
