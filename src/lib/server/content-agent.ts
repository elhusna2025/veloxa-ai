import OpenAI from 'openai';
import { z } from 'zod';
import { ApiError } from './http';
import { generateBrandContentDraft, runAutonomousQualityRepairLoop } from '../veloxa-engine';
import type { runContentCreatorAndCriticAgent } from '../veloxa-openai-agents';

export type ContentAgentParams = Parameters<typeof runContentCreatorAndCriticAgent>[0];
export type ContentAgentResult = Awaited<ReturnType<typeof runContentCreatorAndCriticAgent>>;

const contentOutput = z.object({
  title: z.string().trim().min(1),
  hook: z.string().trim().optional(),
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string().trim().min(1)),
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
        category: params.brand.category,
        city: params.brand.city,
        targetAudience: params.brand.targetAudience,
        brandTone: params.brand.brandTone,
        defaultCta: params.brand.defaultCta,
        forbiddenWords: params.brand.forbiddenWords,
        offerings: params.brand.offerings,
        format: params.format,
        customTopic: params.customTopic,
      };
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
      const ai = contentOutput.parse(parsed);
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
