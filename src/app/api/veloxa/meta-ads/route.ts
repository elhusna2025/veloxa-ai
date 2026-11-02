import { NextResponse } from 'next/server';
import { executeMetaAdsCampaignOnGraphApi } from '@/lib/veloxa-social-publisher';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const receipt = await executeMetaAdsCampaignOnGraphApi({
      campaign: body.campaign,
      adAccountId: body.adAccountId,
      metaAccessToken: body.metaAccessToken,
      targetStatus: body.targetStatus || 'ACTIVE',
    });
    return NextResponse.json({ ok: true, receipt });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Meta Ads execution failed' },
      { status: 500 },
    );
  }
}
