import { NextResponse } from 'next/server';
import { publishDraftToConnectedChannels } from '@/lib/veloxa-social-publisher';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await publishDraftToConnectedChannels({
      draft: body.draft,
      tokens: body.tokens,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Publish failed' },
      { status: 500 },
    );
  }
}
