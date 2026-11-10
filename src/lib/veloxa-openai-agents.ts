/**
 * Veloxa AI — Multi-Agent OpenAI Engine (Inspired by Cendekia Autonomous AI Architecture)
 *
 * 5 Specialized AI Agents:
 * 1. `veloxa-style-dna-vision-agent` (GPT-4.1 Vision): Extracts layout, typography, hook, & color DNA from user reference photos/Reels.
 * 2. `veloxa-content-creator-agent` (GPT-4.1 + gpt-image-1 + gpt-4o-mini-tts): Produces 9:16 Short Video scripts/storyboards, 4:5 Carousels, & Single Posts.
 * 3. `veloxa-quality-gate-critic-agent` (GPT-4.1 Self-Healing Critic): Audits and auto-repairs drafts until 0 issues remain.
 * 4. `veloxa-meta-ads-architect-agent` (GPT-4.1 Marketing Strategist): Designs Meta Ads demographics, geo-radius, validated interests, & budget allocation.
 * 5. `veloxa-meta-ads-media-buyer-agent` (GPT-4.1 Performance Optimizer): Analyzes Meta Ads Insights, pauses expensive variants, & scales winners.
 */

import {
  buildMetaAdCampaignPlan,
  extractStyleDnaFromReference,
  generateBrandContentDraft,
  runAutonomousQualityRepairLoop,
  runMetaAdsAutonomousOptimizer,
} from './veloxa-engine';
import type {
  BrandProfile,
  BrandVaultAsset,
  ChannelConnectionState,
  ContentDraft,
  ContentFormat,
  EventCampaign,
  ExtractedStyleDna,
  MetaAdCampaignPlan,
  MetaAdObjective,
  MetaAdsAccountConnection,
  SubscriptionPlanId,
} from './veloxa-types';

export interface VeloxaOpenAiAgentDefinition {
  agentId: string;
  codeName: string;
  name: string;
  model: string;
  roleDescription: string;
  systemPrompt: string;
  toolsEnabled: string[];
}

export const VELOXA_OPENAI_AGENTS: Record<string, VeloxaOpenAiAgentDefinition> = {
  styleDnaVision: {
    agentId: 'agt_veloxa_style_dna_vision_v1',
    codeName: 'veloxa-style-dna-vision-agent',
    name: 'Veloxa Style DNA Vision Extractor',
    model: 'gpt-4.1',
    roleDescription:
      'Menganalisa contoh foto/poster/Reels referensi milik user di Laci 1 dan mengekstrak DNA komposisi, palet warna, tipografi, dan formula hook.',
    systemPrompt: `Anda adalah Veloxa Style DNA Vision Agent. Tugas Anda adalah menganalisa referensi visual (foto produk, poster event lari, menu cafe, atau video Reels 9:16) yang diunggah pelanggan dan menghasilkan JSON StyleDnaProfile berisi:
- colorMood: suasana pencahayaan & kontras warna
- layoutPattern: tata letak grid, posisi teks, & safe zone 9:16 atau 4:5
- typographyStyle: karakter font judul & subjudul
- hookFormula: pola kalimat pembuka 3 detik pertama
- cameraPacing: ritme transisi visual & zoom
- visualPromptTemplate: instruksi kamera & pencahayaan untuk menjaga konsistensi merek.`,
    toolsEnabled: ['vision_image_analyzer', 'json_schema_output'],
  },
  contentCreator: {
    agentId: 'agt_veloxa_content_creator_v1',
    codeName: 'veloxa-content-creator-agent',
    name: 'Veloxa Multi-Platform Content Creator',
    model: 'gpt-6-luna',
    roleDescription:
      'Merancang konten otonom maupun manual untuk Instagram, Facebook, TikTok, dan YouTube Shorts dengan memadukan foto/video asli bisnis user & kampanye event.',
    systemPrompt: `Anda adalah Veloxa Content Creator Agent. Buat konten media sosial berkonversi tinggi dalam Bahasa Indonesia yang alami, hangat, dan persuasif sesuai Brand Brain user (Cafe/F&B, Event Lari, Klinik Kecantikan, atau Brand Kustom).
Aturan Wajib:
1. Prioritaskan pemakaian foto/video dokumentasi asli user dari Laci 2 (real_asset) bila tersedia.
2. Ikuti Style DNA dari Laci 1 (style_reference).
3. Jika ada Event Campaign aktif (H-30 Teaser, H-14 Early Bird, H-3 Last Call, Hari-H), selaraskan pesan utama dan CTA dengan fase hitung mundur event.
4. Untuk format short_video (9:16), susun 4 adegan dengan durasi total 20–60 detik sesuai panjang pesan yang cocok ditayangkan serentak ke Instagram Reels, Facebook Reels, TikTok, dan YouTube Shorts.`,
    toolsEnabled: ['brand_vault_retriever', 'gpt_image_1_renderer', 'gpt_4o_mini_tts_voiceover'],
  },
  qualityGateCritic: {
    agentId: 'agt_veloxa_quality_gate_critic_v1',
    codeName: 'veloxa-quality-gate-critic-agent',
    name: 'Veloxa Self-Healing Quality Gate Critic',
    model: 'gpt-4.1',
    roleDescription:
      'Memeriksa draf konten secara otonom (kontras teks, zona aman 9:16, kesesuaian Brand Brain, bebas kata terlarang) dan memperbaiki otomatis sampai 0 masalah.',
    systemPrompt: `Anda adalah Veloxa Self-Healing Quality Gate Critic (seperti standar Cendekia Quality Gate).
Periksa setiap draf konten sebelum dipublikasikan ke media sosial pelanggan:
- Pastikan 0 kata terlarang dari daftar forbiddenWords user.
- Pastikan CTA jelas dan mengarah ke WhatsApp/Link Bio user.
- Pastikan teks overlay tidak terpotong di batas atas/bawah layar 9:16 (Reels/TikTok/Shorts).
- Bila ditemukan masalah, lakukan iterasi perbaikan otomatis hingga score >= 95 dan remainingIssues = 0.`,
    toolsEnabled: ['autonomous_critic_loop', 'caption_sanitizer', 'safe_zone_validator'],
  },
  metaAdsArchitect: {
    agentId: 'agt_veloxa_meta_ads_architect_v1',
    codeName: 'veloxa-meta-ads-architect-agent',
    name: 'Veloxa AI Meta Ads Architect',
    model: 'gpt-4.1',
    roleDescription:
      'Merancang struktur kampanye Meta Ads dari sisi demografi usia/lokasi, interest resmi Meta Marketing API, A/B testing iklan, dan pagar pengaman budget.',
    systemPrompt: `Anda adalah Veloxa AI Meta Ads Architect. Tugas Anda adalah menyusun rencana kampanye Meta Ads (Instagram & Facebook Ads) yang siap dieksekusi ke Meta Marketing API:
1. Sisi Demografi: tentukan rentang usia paling potensial, gender, dan titik lokasi kota + radius km.
2. Sisi Interest: petakan kata kunci bisnis user ke Interest resmi Meta Graph API beserta rasionalisasinya.
3. Sisi Budget: hitung pembagian anggaran harian untuk A/B testing kreatif (50%/50%) dan wajib patuhi Pagar Pengaman Budget Harian (dailyHardCapIdr) milik user.`,
    toolsEnabled: ['meta_graph_interest_search', 'meta_reach_estimator', 'hard_budget_cap_guard'],
  },
  metaAdsMediaBuyer: {
    agentId: 'agt_veloxa_meta_ads_buyer_v1',
    codeName: 'veloxa-meta-ads-media-buyer-agent',
    name: 'Veloxa Autonomous AI Media Buyer',
    model: 'gpt-4.1',
    roleDescription:
      'Memantau metrik Meta Ads Insights 24/7, mematikan variasi iklan yang mahal (CPR tinggi), dan mengalihkan 100% budget harian ke variasi pemenang.',
    systemPrompt: `Anda adalah Veloxa Autonomous AI Media Buyer. Evaluasi performa setiap variasi iklan (CTR, jumlah konversi, dan Cost Per Result/CPR).
Matikan variasi iklan yang memiliki CPR tertinggi (paused_by_ai_loser) dan alokasikan 100% anggaran harian ke variasi dengan CPR terendah (winner_scaled). Catat ringkasan penghematan dalam Bahasa Indonesia yang transparan bagi pemilik bisnis.`,
    toolsEnabled: ['meta_insights_analyzer', 'adset_budget_reallocator'],
  },
};

async function callOpenAiJson<T>(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        response_format: { type: 'json_object' },
        temperature: 0.4,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function runStyleDnaVisionAgent(params: {
  title: string;
  description: string;
  mediaType: 'photo' | 'video_reel';
  category: BrandProfile['category'];
  imageUrl?: string;
  openAiApiKey?: string;
}): Promise<{ styleDna: ExtractedStyleDna; engineMode: 'openai_live' | 'deterministic_local' }> {
  const fallback = extractStyleDnaFromReference({
    title: params.title,
    description: params.description,
    mediaType: params.mediaType,
    category: params.category,
  });

  const apiKey = params.openAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { styleDna: fallback, engineMode: 'deterministic_local' };
  }

  const aiResult = await callOpenAiJson<Partial<ExtractedStyleDna>>({
    apiKey,
    model: VELOXA_OPENAI_AGENTS.styleDnaVision.model,
    systemPrompt: VELOXA_OPENAI_AGENTS.styleDnaVision.systemPrompt,
    userPrompt: JSON.stringify({
      title: params.title,
      description: params.description,
      mediaType: params.mediaType,
      category: params.category,
      imageUrl: params.imageUrl,
    }),
  });

  if (!aiResult || !aiResult.layoutPattern) {
    return { styleDna: fallback, engineMode: 'deterministic_local' };
  }

  return {
    styleDna: {
      colorMood: aiResult.colorMood || fallback.colorMood,
      layoutPattern: aiResult.layoutPattern || fallback.layoutPattern,
      typographyStyle: aiResult.typographyStyle || fallback.typographyStyle,
      hookFormula: aiResult.hookFormula || fallback.hookFormula,
      pacingNotes: aiResult.pacingNotes || fallback.pacingNotes,
    },
    engineMode: 'openai_live',
  };
}

export async function runContentCreatorAndCriticAgent(params: {
  brand: BrandProfile;
  format: ContentFormat;
  source: ContentDraft['source'];
  customTopic?: string;
  vaultAssets: BrandVaultAsset[];
  connections: ChannelConnectionState[];
  planId: SubscriptionPlanId;
  activeCampaign?: EventCampaign;
  scheduledForWib?: string;
  openAiApiKey?: string;
}): Promise<{ draft: ContentDraft; engineMode: 'openai_live' | 'deterministic_local' }> {
  const baseDraft = generateBrandContentDraft(params);
  const apiKey = params.openAiApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { draft: baseDraft, engineMode: 'deterministic_local' };
  }

  const aiOverride = await callOpenAiJson<{
    title?: string;
    caption?: string;
    hashtags?: string[];
  }>({
    apiKey,
    model: VELOXA_OPENAI_AGENTS.contentCreator.model,
    systemPrompt: VELOXA_OPENAI_AGENTS.contentCreator.systemPrompt,
    userPrompt: JSON.stringify({
      businessName: params.brand.businessName,
      category: params.brand.category,
      city: params.brand.city,
      brandTone: params.brand.brandTone,
      targetAudience: params.brand.targetAudience,
      defaultCta: params.brand.defaultCta,
      forbiddenWords: params.brand.forbiddenWords,
      format: params.format,
      customTopic: params.customTopic,
      activeCampaign: params.activeCampaign,
    }),
  });

  if (!aiOverride || !aiOverride.caption) {
    return { draft: baseDraft, engineMode: 'deterministic_local' };
  }

  const repaired = runAutonomousQualityRepairLoop({
    title: aiOverride.title || baseDraft.title,
    hook: baseDraft.hook,
    caption: aiOverride.caption,
    brand: params.brand,
  });

  return {
    draft: {
      ...baseDraft,
      title: aiOverride.title || baseDraft.title,
      caption: repaired.repairedCaption,
      hashtags:
        Array.isArray(aiOverride.hashtags) && aiOverride.hashtags.length > 0
          ? aiOverride.hashtags
          : baseDraft.hashtags,
      qualityReview: repaired.review,
    },
    engineMode: 'openai_live',
  };
}

export async function runMetaAdsArchitectAgent(params: {
  brand: BrandProfile;
  metaAccount: MetaAdsAccountConnection;
  objective: MetaAdObjective;
  promotedOfferingTitle: string;
  requestedDailyBudgetIdr: number;
  durationDays: number;
  targetCity?: string;
  radiusKm?: number;
  ageMin?: number;
  ageMax?: number;
  customInterestKeyword?: string;
  originatedFromOrganicDraft?: ContentDraft;
  openAiApiKey?: string;
}): Promise<{ campaignPlan: MetaAdCampaignPlan; engineMode: 'openai_live' | 'deterministic_local' }> {
  const basePlan = buildMetaAdCampaignPlan(params);
  const apiKey = params.openAiApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { campaignPlan: basePlan, engineMode: 'deterministic_local' };
  }

  const aiCreative = await callOpenAiJson<{
    variantAHeadline?: string;
    variantAPrimaryText?: string;
    variantBHeadline?: string;
    variantBPrimaryText?: string;
  }>({
    apiKey,
    model: VELOXA_OPENAI_AGENTS.metaAdsArchitect.model,
    systemPrompt: VELOXA_OPENAI_AGENTS.metaAdsArchitect.systemPrompt,
    userPrompt: JSON.stringify({
      businessName: params.brand.businessName,
      city: params.targetCity || params.brand.city,
      promotedOfferingTitle: params.promotedOfferingTitle,
      objective: params.objective,
      dailyBudgetIdr: basePlan.budget.appliedDailyBudgetIdr,
    }),
  });

  if (aiCreative && basePlan.creatives.length >= 2) {
    basePlan.creatives[0].headline = aiCreative.variantAHeadline || basePlan.creatives[0].headline;
    basePlan.creatives[0].primaryText =
      aiCreative.variantAPrimaryText || basePlan.creatives[0].primaryText;
    basePlan.creatives[1].headline = aiCreative.variantBHeadline || basePlan.creatives[1].headline;
    basePlan.creatives[1].primaryText =
      aiCreative.variantBPrimaryText || basePlan.creatives[1].primaryText;
    return { campaignPlan: basePlan, engineMode: 'openai_live' };
  }

  return { campaignPlan: basePlan, engineMode: 'deterministic_local' };
}

export function runMetaAdsMediaBuyerOptimizerAgent(campaign: MetaAdCampaignPlan): MetaAdCampaignPlan {
  return runMetaAdsAutonomousOptimizer(campaign);
}
