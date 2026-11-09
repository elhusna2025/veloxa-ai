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

const videoScript = {
  opening: 'Pagi ini, mulai langkah kecil untuk menjaga energi dan semangat sepanjang hari.',
  scenes: [
    { time: '00:00–00:06', visual: 'Cahaya pagi di meja sederhana.', voiceover: 'Pagi ini, mulai langkah kecil untuk menjaga energi dan semangat sepanjang hari.', textOverlay: 'Mulai dari langkah kecil' },
    { time: '00:06–00:12', visual: 'Menu disiapkan dengan teliti.', voiceover: 'Pilih menu yang dibuat segar, nikmati rasa seimbang, dan luangkan waktu untuk diri sendiri.', textOverlay: 'Segar dan seimbang' },
    { time: '00:12–00:18', visual: 'Suasana hangat di Studio Nusa.', voiceover: 'Di Studio Nusa, setiap pilihan diracik dengan perhatian agar momen sederhana terasa lebih istimewa.', textOverlay: 'Diracik dengan perhatian' },
    { time: '00:18–00:30', visual: 'Sajian dinikmati bersama teman.', voiceover: 'Datang hari ini, temukan favoritmu, lalu bagikan pengalaman menyenangkan bersama orang terdekat.', textOverlay: 'Temukan favoritmu hari ini' },
  ],
  closing: 'Datang hari ini, temukan favoritmu, lalu bagikan pengalaman menyenangkan bersama orang terdekat.',
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

const carouselSlides = [
  { headline: 'Judul slide satu', body: 'Isi slide satu', visualDirection: 'Arahan visual satu' },
  { headline: 'Judul slide dua', body: 'Isi slide dua', visualDirection: 'Arahan visual dua' },
  { headline: 'Judul slide tiga', body: 'Isi slide tiga', visualDirection: 'Arahan visual tiga' },
  { headline: 'Judul slide empat', body: 'Isi slide empat', visualDirection: 'Arahan visual empat' },
  { headline: 'Judul slide lima', body: 'Isi slide lima', visualDirection: 'Arahan visual lima' },
];

test('post tunggal dan carousel menerima bagian video kosong dari schema agen tersimpan', async () => {
  for (const format of ['single_post', 'carousel'] as const) {
    const params = makeParams(); params.format = format;
    const { client, calls } = mockClient({ ...generatedCopy, slides: format === 'carousel' ? carouselSlides : [], videoScript: { opening: '', scenes: [], closing: '' }, visualPrompt: 'Arahan visual' });
    const result = await createContentAgentGenerator(client as never, agentId)(params);
    assert.equal(result.engineMode, 'openai_live');
    assert.equal(result.draft.title, generatedCopy.title);
    if (format === 'carousel') assert.equal(result.draft.slides?.length, 5);
    assert.equal(calls.aborted, true);
  }
});

test('Reels tetap menolak naskah video kosong meskipun bagian lain valid', async () => {
  const params = makeParams(); params.format = 'short_video';
  const { client } = mockClient({ ...generatedCopy, slides: [], videoScript: { opening: '', scenes: [], closing: '' } });
  await assert.rejects(createContentAgentGenerator(client as never, agentId)(params), /respons yang tidak valid/i);
});

test('carousel memakai tepat lima slide AI sesuai urutan keluaran', async () => {
  const params = makeParams();
  params.format = 'carousel';
  const { client, calls } = mockClient({ ...generatedCopy, slides: carouselSlides });
  const result = await createContentAgentGenerator(client as never, agentId)(params);

  assert.deepEqual(JSON.parse(String(calls.request?.input)).extraInstructions,
    'Untuk format carousel, hasilkan tepat 5 slide dengan headline, body, dan visualDirection masing-masing.');
  assert.deepEqual(result.draft.slides, carouselSlides.map((slide, index) => ({
    slideNumber: index + 1,
    ...slide,
    badgeText: `${index + 1}/5`,
  })));
});

test('carousel menolak slide hilang, jumlah tidak tepat, atau teks slide tidak valid', async () => {
  const malformedOutputs = [
    generatedCopy,
    { ...generatedCopy, slides: [] },
    { ...generatedCopy, slides: carouselSlides.slice(0, 4) },
    { ...generatedCopy, slides: [...carouselSlides, carouselSlides[0]] },
    { ...generatedCopy, slides: [{ ...carouselSlides[0], headline: ' ' }, ...carouselSlides.slice(1)] },
    { ...generatedCopy, slides: [{ ...carouselSlides[0], body: 'x'.repeat(401) }, ...carouselSlides.slice(1)] },
    { ...generatedCopy, slides: [{ ...carouselSlides[0], visualDirection: 'x'.repeat(1001) }, ...carouselSlides.slice(1)] },
  ];

  for (const output of malformedOutputs) {
    const params = makeParams();
    params.format = 'carousel';
    const { client } = mockClient(output);
    await assert.rejects(createContentAgentGenerator(client as never, agentId)(params), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 502);
      assert.equal((error as { code?: string }).code, 'invalid_content_agent_response');
      return true;
    });
  }
});

test('carousel menolak kata terlarang pada headline atau body tanpa menyetujui teksnya', async () => {
  const params = makeParams();
  params.format = 'carousel';
  params.brand.forbiddenWords = ['RAHASIA'];
  const slides = carouselSlides.map((slide, index) => index === 2
    ? { ...slide, body: 'Informasi rahasia tidak boleh disetujui.' }
    : slide);
  const { client } = mockClient({ ...generatedCopy, slides });

  await assert.rejects(createContentAgentGenerator(client as never, agentId)(params), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 502);
    assert.equal((error as { code?: string }).code, 'invalid_content_agent_response');
    return true;
  });
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

test('short_video memetakan empat adegan dari skrip AI tanpa placeholder dan meminta format Reels IG/FB', async () => {
  const params = makeParams();
  params.format = 'short_video';
  const { client, calls } = mockClient({ ...generatedCopy, videoScript });
  const result = await createContentAgentGenerator(client as never, agentId)(params);
  const brief = JSON.parse(String(calls.request?.input));

  assert.match(brief.extraInstructions, /Instagram dan Facebook/);
  assert.match(brief.extraInstructions, /20–30 detik/);
  assert.match(brief.extraInstructions, /tepat 4 adegan/);
  assert.match(brief.extraInstructions, /40–65 kata Bahasa Indonesia/);
  assert.deepEqual(result.draft.videoScenes, videoScript.scenes.map((scene, index) => ({
    sceneNumber: index + 1,
    timeRange: scene.time,
    visualDirection: scene.visual,
    voiceover: scene.voiceover,
    textOverlay: scene.textOverlay,
  })));
  assert.equal(result.draft.videoScenes?.length, 4);
  assert.equal(result.draft.videoDurationSeconds, 30);
  assert.equal(result.draft.voiceoverModel, 'gpt-realtime-2.1-mini');
  assert.equal(result.draft.renderedVideo, undefined);
  assert.ok(result.draft.targetChannels.every((channel) => channel === 'instagram' || channel === 'facebook'));
  assert.ok(result.draft.channelStatuses.every((status) => status.channel === 'instagram' || status.channel === 'facebook'));
});

test('short_video menolak skrip malformed dengan error aman dan tanpa fallback placeholder', async () => {
  const malformedOutputs: Array<{ label: string; output: unknown }> = [
    { label: 'skrip hilang', output: generatedCopy },
    { label: 'opening terpisah', output: { ...generatedCopy, videoScript: { ...videoScript, opening: 'Pembuka yang tidak dinarasikan.' } } },
    { label: 'closing terpisah', output: { ...generatedCopy, videoScript: { ...videoScript, closing: 'Penutup yang tidak dinarasikan.' } } },
    { label: 'voiceover tanpa kata lisan', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.map((scene) => ({ ...scene, voiceover: '- - -' })) } } },
    { label: 'jumlah adegan kurang', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.slice(0, 3) } } },
    { label: 'jumlah adegan berlebih', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: [...videoScript.scenes, videoScript.scenes[0]] } } },
    { label: 'voiceover melampaui batas karakter', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.map((scene, index) => index === 0 ? { ...scene, voiceover: 'x'.repeat(181) } : scene) } } },
    { label: 'overlay kosong', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.map((scene, index) => index === 0 ? { ...scene, textOverlay: ' ' } : scene) } } },
    { label: 'visual melampaui batas karakter', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.map((scene, index) => index === 0 ? { ...scene, visual: 'x'.repeat(1001) } : scene) } } },
    { label: 'jumlah kata di bawah batas', output: { ...generatedCopy, videoScript: { ...videoScript, scenes: videoScript.scenes.map((scene) => ({ ...scene, voiceover: 'Satu' })) } } },
  ];

  for (const { label, output } of malformedOutputs) {
    const params = makeParams();
    params.format = 'short_video';
    const { client } = mockClient(output);
    await assert.rejects(createContentAgentGenerator(client as never, agentId)(params), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 502, label);
      assert.equal((error as { code?: string }).code, 'invalid_content_agent_response', label);
      return true;
    }, label);
  }
});

test('short_video menolak kata terlarang pada voiceover maupun text overlay', async () => {
  for (const field of ['voiceover', 'textOverlay'] as const) {
    const params = makeParams();
    params.format = 'short_video';
    params.brand.forbiddenWords = ['rahasia'];
    const invalidScript = {
      ...videoScript,
      scenes: videoScript.scenes.map((scene, index) => index === 2
        ? { ...scene, [field]: field === 'voiceover' ? 'Informasi rahasia tidak boleh disampaikan kepada pelanggan.' : 'Ini rahasia untuk pelanggan.' }
        : scene),
    };
    const { client } = mockClient({ ...generatedCopy, videoScript: invalidScript });

    await assert.rejects(createContentAgentGenerator(client as never, agentId)(params), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 502);
      assert.equal((error as { code?: string }).code, 'invalid_content_agent_response');
      return true;
    }, field);
  }
});

test('menolak agen yang modelnya tidak sesuai atau memiliki tools', async () => {
  for (const options of [{ model: 'other-model' }, { tools: [{ type: 'unexpected' }] }]) {
    const { client } = mockClient(generatedCopy, options);
    const generate = createContentAgentGenerator(client as never, agentId);
    await assert.rejects(generate(makeParams()), /belum sesuai/i);
  }
});
