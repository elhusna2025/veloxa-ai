import{analyzeReferenceBlend}from'@/lib/server/reference-blend';import{errorResponse,noStoreJson}from'@/lib/server/http';
import type { BlendStage } from '@/lib/reference-blend';
export const runtime='nodejs';export const maxDuration=120;
export async function POST(request: Request) {
 const carouselPlan = new URL(request.url).searchParams.get('mode') === 'carousel-plan';
 const analyze = (progress?: (stage: BlendStage) => void) => carouselPlan
  ? analyzeReferenceBlend(request, { progress }, true)
  : analyzeReferenceBlend(request, { progress });
 if (!request.headers.get('Accept')?.includes('application/x-ndjson')) {
  try { return noStoreJson(await analyze()); } catch (error) { return errorResponse(error); }
 }
 const stream = new ReadableStream({
  async start(controller) {
   const emit = (value: unknown) => {
    try { controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + '\n')); } catch {}
   };
   try {
    const data = await analyze(stage => emit({ type: 'progress', stage }));
    emit({ type: 'complete', data });
   } catch (error) {
    const result = await errorResponse(error).json();
    emit({ type: 'error', error: result.error });
   } finally {
    try { controller.close(); } catch {}
   }
  },
 });
 return new Response(stream, {
  headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' },
 });
}
