import OpenAI from 'openai';
import { forbiddenContentMatches } from '../content-policy';
import { businessCategoryLabel } from '../business-categories';
import { z } from 'zod';
import { ApiError } from './http';
import { generateBrandContentDraft, runAutonomousQualityRepairLoop } from '../veloxa-engine';
import type { runContentCreatorAndCriticAgent } from '../veloxa-openai-agents';

export type ContentAgentParams = Parameters<typeof runContentCreatorAndCriticAgent>[0] & { referenceBrief?: { titles: string[]; instruction: string } };
export type ContentAgentResult = Awaited<ReturnType<typeof runContentCreatorAndCriticAgent>>;

const contentOutput = z.object({
  title: z.string().trim().min(1),
  hook: z.string().trim().optional(),
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string().trim().min(1)),
});

const carouselOutput = z.object({
  slides: z.array(z.object({
    headline: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(400),
    visualDirection: z.string().trim().min(1).max(1000),
  })),
});

const reelsOutput = z.object({
  videoScript: z.object({
    opening: z.string().trim().min(1),
    scenes: z.array(z.object({
      time: z.string().trim().min(1),
      visual: z.string().trim().min(1).max(1000),
      voiceover: z.string().trim().min(1).max(180),
      textOverlay: z.string().trim().min(1).max(120),
    })),
    closing: z.string().trim().min(1),
  }),
});

interface AgentStream {
  finalResult(): Promise<{ output_text?: string }>;
  controller: { abort(): void };
}

interface AgentsClient {
  beta: {
    agents: {
      retrieve(agentId: string): Promise<{ model?: string; tools?: unknown[] }>;
      sessions: {
        create(params: {
          agent_id: string;
          environment: { type: 'none' };
          input: string;
          stream: true;
        }): Promise<AgentStream>;
      };
    };
  };
}

const savedAgentId = 'agent_3c670aa7406f45918fdb3023c7e617a49f8dc033e5274be0bf';

function safeProviderError(): ApiError {
  return new ApiError(503, 'Layanan pembuatan konten AI belum dapat menyelesaikan permintaan. Silakan coba lagi.', 'content_agent_unavailable');
}

export function createContentAgentGenerator(client: AgentsClient, agentId: string) {
  return async function generateContentWithClient(params: ContentAgentParams): Promise<ContentAgentResult> {
    const scaffold = generateBrandContentDraft(params);
    let stream: AgentStream | undefined;

    try {
      const agent = await client.beta.agents.retrieve(agentId);
      if (agent.model !== 'gpt-6-luna' || !Array.isArray(agent.tools) || agent.tools.length !== 0) {
        throw new ApiError(503, 'Konfigurasi agen konten belum sesuai.', 'content_agent_unavailable');
      }

      const brief = {
        businessName: params.brand.businessName,
        businessDescription: params.brand.businessDescription,
        referenceBrief: params.referenceBrief,
        category: params.brand.category,
        categoryLabel: businessCategoryLabel(params.brand.category),
        serviceArea: params.brand.city.trim(),
        websiteUrl: params.brand.websiteUrl,
        targetAudience: params.brand.targetAudience,
        brandTone: params.brand.brandTone,
        defaultCta: params.brand.defaultCta,
        forbiddenWords: params.brand.forbiddenWords,
        offerings: params.brand.offerings,
        format: params.format,
        customTopic: params.customTopic,
        extraInstructions: params.format === 'carousel'
          ? 'Untuk format carousel, hasilkan tepat 5 slide dengan headline, body, dan visualDirection masing-masing.'
          : params.format === 'short_video'
            ? 'Untuk short_video Reels Instagram dan Facebook berdurasi 20–30 detik, hasilkan tepat 4 adegan. Total seluruh voiceover harus 40–65 kata Bahasa Indonesia; voiceover keempat adegan harus sudah memuat opening dan closing, tanpa narasi terpisah. Gunakan kalimat pendek yang nyaman diucapkan, ritme bervariasi, pembuka mengundang rasa ingin tahu dan penutup menenangkan. Tulis sebagai percakapan lisan yang luwes sesuai brandTone, bukan bahasa presentasi; pilih sapaan dan penghubung sehari-hari secukupnya, tanpa kalimat kaku atau nada iklan. Gaya bercerita hangat seperti berbagi tips kepada teman, bukan membaca pengumuman. Sertakan opening yang sama persis dengan voiceover adegan pertama dan closing yang sama persis dengan voiceover adegan terakhir; scenes berisi time, visual, voiceover, textOverlay.'
            : undefined,
      };
      brief.extraInstructions = [brief.extraInstructions, 'categoryLabel adalah bidang bisnis penyedia, bukan bidang pelanggannya. targetAudience adalah pelanggan yang ingin dijangkau. serviceArea adalah cakupan layanan pelanggan, bukan alamat kantor; jika kosong jangan mengarang lokasi. Jangan menyimpulkan harga atau promosi jika tidak dicantumkan.'].filter(Boolean).join(' ');
      if(params.format!=='single_post') brief.extraInstructions=[brief.extraInstructions,'Setiap visualDirection (carousel) atau visual (Reels) harus menggambarkan pesan spesifik headline/body atau narasi pada slide/adegan tersebut, dengan subjek dan aktivitas yang relevan. Bedakan adegan sesuai pesan: jangan ulang satu latar abstrak atau adegan bisnis umum untuk semua slide. Pilih satu arahan seni dan nuansa visual yang konsisten sebagai satu seri; jaga variasi komposisi per slide. Gunakan konteks deskripsi dan produk bisnis yang benar, tanpa mengarang antarmuka produk, angka, harga atau testimoni.'].filter(Boolean).join(' ');
      brief.extraInstructions = [brief.extraInstructions,'Teks visual ditata secara terpisah dari foto AI. Buat judul konkret maksimal 8 kata, hook dan isi per slide ringkas maksimal 18 kata. Jangan menaruh seluruh narasi Reels di textOverlay; gunakan overlay singkat. CTA visual harus singkat; URL tetap berasal dari website bisnis tersimpan.'].filter(Boolean).join(' ');
      if (params.referenceBrief) brief.extraInstructions = [brief.extraInstructions, 'Ikuti referenceBrief.instruction untuk arahan komposisi visual pada seluruh slide/adegan. ReferenceBrief.titles hanya keterangan foto, bukan sumber klaim tentang bisnis. Jangan mengarang fitur atau harga dari judul foto.'].filter(Boolean).join(' ');
      stream = await client.beta.agents.sessions.create({
        agent_id: agentId,
        environment: { type: 'none' },
        input: JSON.stringify(brief),
        stream: true,
      });

      const result = await stream.finalResult();
      if (typeof result.output_text !== 'string') {
        throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.output_text);
      } catch {
        throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
      }
      // The saved agent returns all schema fields. Ignore unused format fields,
      // which legitimately contain empty strings/arrays for posts and carousels.
      const ai = { ...contentOutput.parse(parsed),
        slides: params.format === 'carousel' ? carouselOutput.parse(parsed).slides : undefined,
        videoScript: params.format === 'short_video' ? reelsOutput.parse(parsed).videoScript : undefined,
      };
      if (params.format === 'carousel') {
        if (!ai.slides || ai.slides.length !== 5) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
        const forbiddenWords = params.brand.forbiddenWords.map((word) => word.trim().toLowerCase()).filter(Boolean);
        if (ai.slides.some((slide) => forbiddenWords.some((word) =>
          slide.headline.toLowerCase().includes(word) || slide.body.toLowerCase().includes(word),
        ))) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
      }
      if (params.format === 'short_video') {
        const script = ai.videoScript;
        if (!script || script.scenes.length !== 4) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
        if (script.opening !== script.scenes[0].voiceover || script.closing !== script.scenes[3].voiceover) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
        const spokenWordCount = script.scenes.map(scene => scene.voiceover).join(' ').trim().split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
        if (spokenWordCount < 40 || spokenWordCount > 65) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
        const forbiddenWords = params.brand.forbiddenWords.map((word) => word.trim().toLowerCase()).filter(Boolean);
        if (script.scenes.some((scene) => forbiddenWords.some((word) =>
          scene.voiceover.toLowerCase().includes(word) || scene.textOverlay.toLowerCase().includes(word),
        ))) {
          throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
        }
      }
      const repaired = runAutonomousQualityRepairLoop({
        title: ai.title,
        hook: ai.hook || ai.caption,
        caption: ai.caption,
        brand: params.brand,
      });
      const draft = {
        ...scaffold,
        title: ai.title,
        hook: repaired.repairedHook,
        caption: repaired.repairedCaption,
        hashtags: ai.hashtags,
        qualityReview: repaired.review,
      };

      if (params.format === 'carousel' && ai.slides) {
        draft.slides = ai.slides.map((slide, index) => ({
          slideNumber: index + 1,
          headline: slide.headline,
          body: slide.body,
          visualDirection: slide.visualDirection,
          badgeText: `${index + 1}/5`,
        }));
      }

      if (params.format === 'short_video' && ai.videoScript) {
        draft.videoScenes = ai.videoScript.scenes.map((scene, index) => ({
          sceneNumber: index + 1,
          timeRange: scene.time,
          visualDirection: scene.visual,
          voiceover: scene.voiceover,
          textOverlay: scene.textOverlay,
        }));
        draft.videoDurationSeconds = 30;
        draft.voiceoverModel = 'gpt-realtime-2.1-mini';
        draft.targetChannels = draft.targetChannels.filter((channel) => channel === 'instagram' || channel === 'facebook');
        draft.channelStatuses = draft.channelStatuses.filter((status) => status.channel === 'instagram' || status.channel === 'facebook');
      }

      if (params.format === 'single_post' && draft.slides?.length) {
        draft.slides = draft.slides.map((slide, index) => index === 0
          ? {
              ...slide,
              headline: ai.title,
              body: repaired.repairedHook || repaired.repairedCaption,
              badgeText: 'POST TUNGGAL 4:5',
            }
          : slide);
      }

      if(forbiddenContentMatches(draft,params.brand.forbiddenWords).length)throw new ApiError(502,'Naskah AI memuat kata yang dihindari dalam teks atau hashtag. Tinjau panduan konten lalu coba lagi.','content_policy_violation');
      return { draft, engineMode: 'openai_live' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof z.ZodError) {
        throw new ApiError(502, 'Agen konten menghasilkan respons yang tidak valid.', 'invalid_content_agent_response');
      }
      throw safeProviderError();
    } finally {
      stream?.controller.abort();
    }
  };
}

export async function generateContentWithSavedAgent(params: ContentAgentParams): Promise<ContentAgentResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const agentId = process.env.OPENAI_CONTENT_AGENT_ID;
  if (!apiKey || !agentId) {
    throw new ApiError(503, 'Konfigurasi agen konten belum lengkap.', 'content_agent_unavailable');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    maxRetries: 0,
    timeout: 85_000,
  });
  return createContentAgentGenerator(client as unknown as AgentsClient, agentId)(params);
}
