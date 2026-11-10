import { publishSocialContent } from '@/lib/server/publishing';
import { errorResponse, noStoreJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const result = await publishSocialContent(request);
    return noStoreJson({ ok: result.receipts.every(receipt => receipt.status === 'published'), ...result });
  } catch (error) { return errorResponse(error); }
}
