import { requireUser } from '@/lib/server/auth';
import { noStoreJson, errorResponse } from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    await requireUser(request);
    return noStoreJson({ ok: false, error: 'Buat konten melalui Studio Veloxa.', code: 'use_content_endpoint' }, 410);
  } catch (error) { return errorResponse(error); }
}
