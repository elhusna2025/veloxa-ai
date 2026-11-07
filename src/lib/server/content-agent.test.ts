import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContentAgentGenerator, type ContentAgentParams } from './content-agent';
import { buildRenderedVisualSvg } from '../veloxa-visual-renderer';

const agentId = 'agent_3c670aa7406f45918fdb3023c7e617a49f8dc033e5274be0bf';

function makeParams(): ContentAgentParams {
  return {
    brand: {
      workspaceId: 'workspace-test',
      businessName: 'Studio Nusa',
      category: 'custom',
      city: 'Bandung',
      targetAudience: 'Pemilik usaha lokal',
      brandTone: 'Hangat dan jelas',
      primaryColorHex: '#FFFFFF',
      accentColorHex: '#EC749B',
      visualVibe: 'Minimal',
      defaultCta: 'Hubungi kami',
      whatsappNumber: '',
      websiteUrl: '',
      forbiddenWords: [],
      prioritizeRealAssets: false,
      offerings: [],
    },
    format: 'single_post',
    source: 'manual_studio',
    customTopic: 'USER_PROMPT_SENTINEL instruksi yang tidak boleh tampil sebagai judul',
    vaultAssets: [],
    connections: [],
    planId: 'free_trial',
  };
}

function mockClient(output: unknown, options: { failRetrieve?: boolean; model?: string; tools?: unknown[] } = {}) {
  const calls: { retrieved?: string; request?: Record<string, unknown>; aborted: boolean } = { aborted: false };
  const client = {
    beta: {
      agents: {
        retrieve: async (id: string) => {
          calls.retrieved = id;
          if (options.failRetrieve) throw new Error('provider body contains secret-token');
          return { model: options.model ?? 'gpt-6-luna', tools: options.tools ?? [] };
        },
        sessions: {
          create: async (request: Record<string, unknown>) => {
            calls.request = request;
            return {
              finalResult: async () => ({ output_text: typeof output === 'string' ? output : JSON.stringify(output) }),
              controller: { abort: () => { calls.aborted = true; } },
            };
          },
        },
      },
    },
  };
  return { client, calls };
}

const generatedCopy = {
  title: 'Ide Segar',
  hook: 'Mulai Hari Ini',
  caption: 'Temukan cara baru untuk mengembangkan usaha lokal.',
  hashtags: ['#UsahaLokal'],
};

test('memakai agen tersimpan dan merender salinan AI, bukan scaffold atau prompt pengguna', async () => {
  const { client, calls } = mockClient(generatedCopy);
  const generate = createContentAgentGenerator(client as never, agentId);
  const result = await generate(makeParams());

  assert.equal(calls.retrieved, agentId);
  assert.deepEqual(calls.request, {
    agent_id: agentId,
    environment: { type: 'none' },
    input: JSON.stringify({
      businessName: 'Studio Nusa',
      category: 'custom',
      city: 'Bandung',
      targetAudience: 'Pemilik usaha lokal',
      brandTone: 'Hangat dan jelas',
      defaultCta: 'Hubungi kami',
      forbiddenWords: [],
      offerings: [],
      format: 'single_post',
      customTopic: 'USER_PROMPT_SENTINEL instruksi yang tidak boleh tampil sebagai judul',
    }),
    stream: true,
  });
  assert.equal(calls.aborted, true);
  assert.equal(result.engineMode, 'openai_live');
  assert.equal(result.draft.title, generatedCopy.title);
  assert.ok(result.draft.caption.startsWith(generatedCopy.caption));
  assert.equal(result.draft.slides?.[0].headline, generatedCopy.title);
  assert.equal(result.draft.slides?.[0].body, result.draft.hook);
  assert.equal(result.draft.slides?.[0].badgeText, 'POST TUNGGAL 4:5');

  const svg = buildRenderedVisualSvg({ brand: makeParams().brand, draft: result.draft });
  assert.ok(svg.includes('Ide Segar'));
  assert.ok(svg.includes('Mulai Hari Ini'));
  assert.ok(!svg.includes('USER_PROMPT_SENTINEL'));
});

test('JSON keluaran yang malformed ditolak dan stream tetap dibatalkan', async () => {
  const { client, calls } = mockClient('{malformed json');
  const generate = createContentAgentGenerator(client as never, agentId);
  await assert.rejects(generate(makeParams()), /respons yang tidak valid/i);
  assert.equal(calls.aborted, true);
});

test('kegagalan provider menjadi error aman dan tidak menghasilkan draf buatan', async () => {
  const { client } = mockClient(generatedCopy, { failRetrieve: true });
  const generate = createContentAgentGenerator(client as never, agentId);
  await assert.rejects(generate(makeParams()), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 503);
    assert.equal((error as Error).message.includes('secret-token'), false);
    return true;
  });
});

test('menolak agen yang modelnya tidak sesuai atau memiliki tools', async () => {
  for (const options of [{ model: 'other-model' }, { tools: [{ type: 'unexpected' }] }]) {
    const { client } = mockClient(generatedCopy, options);
    const generate = createContentAgentGenerator(client as never, agentId);
    await assert.rejects(generate(makeParams()), /belum sesuai/i);
  }
});
