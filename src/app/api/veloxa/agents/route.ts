import { NextResponse } from 'next/server';
import {
  VELOXA_OPENAI_AGENTS,
  runContentCreatorAndCriticAgent,
  runMetaAdsArchitectAgent,
  runMetaAdsMediaBuyerOptimizerAgent,
  runStyleDnaVisionAgent,
} from '@/lib/veloxa-openai-agents';

export async function GET() {
  return NextResponse.json({
    ok: true,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    agents: Object.values(VELOXA_OPENAI_AGENTS),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, openAiApiKey } = body;

    if (action === 'style_dna_vision') {
      const result = await runStyleDnaVisionAgent({
        title: body.title,
        description: body.description,
        mediaType: body.mediaType,
        category: body.category,
        imageUrl: body.imageUrl,
        openAiApiKey,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'content_creator_and_critic') {
      const result = await runContentCreatorAndCriticAgent({
        brand: body.brand,
        format: body.format,
        source: body.source,
        customTopic: body.customTopic,
        vaultAssets: body.vaultAssets || [],
        connections: body.connections || [],
        planId: body.planId,
        activeCampaign: body.activeCampaign,
        scheduledForWib: body.scheduledForWib,
        openAiApiKey,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'meta_ads_architect') {
      const result = await runMetaAdsArchitectAgent({
        brand: body.brand,
        metaAccount: body.metaAccount,
        objective: body.objective,
        promotedOfferingTitle: body.promotedOfferingTitle,
        requestedDailyBudgetIdr: body.requestedDailyBudgetIdr,
        durationDays: body.durationDays,
        targetCity: body.targetCity,
        radiusKm: body.radiusKm,
        ageMin: body.ageMin,
        ageMax: body.ageMax,
        customInterestKeyword: body.customInterestKeyword,
        originatedFromOrganicDraft: body.originatedFromOrganicDraft,
        openAiApiKey,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'meta_ads_media_buyer') {
      const optimized = runMetaAdsMediaBuyerOptimizerAgent(body.campaign);
      return NextResponse.json({ ok: true, campaign: optimized });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown agent action: ${String(action)}` },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
