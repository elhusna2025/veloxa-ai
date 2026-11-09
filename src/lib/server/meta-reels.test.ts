import test from 'node:test';
import assert from 'node:assert/strict';
import { publishMetaReel } from './meta-reels';
import { MetaRequestError } from './meta-graph';
const credential = 'fake-credential';
const base = { accountId: '100', ['token']: credential, videoUrl: 'https://example.test/reel.mp4', videoBytes: Buffer.from('mock-mp4'), caption: 'Tips belajar. Voiceover menggunakan suara AI.' };
const ok = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const sleep = async () => {};
test('IG Reels waits for readiness and publishes the reviewed URL and caption once', async () => {
  const paths: string[] = []; let polls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input)); paths.push(u.pathname); assert.ok(!u.href.includes(credential));
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${credential}`);
    const form = new URLSearchParams(String(init?.body || ''));
    if (u.pathname.endsWith('/media')) { assert.equal(form.get('media_type'), 'REELS'); assert.equal(form.get('video_url'), base.videoUrl); assert.equal(form.get('caption'), base.caption); assert.equal(form.get('share_to_feed'), 'true'); return ok({ id: '300' }); }
    if (u.pathname.endsWith('/300')) return ok({ status_code: ++polls === 1 ? 'IN_PROGRESS' : 'FINISHED' });
    if (u.pathname.endsWith('/media_publish')) { assert.equal(polls, 2); assert.equal(form.get('creation_id'), '300'); return ok({ id: '400' }); }
    return ok({ permalink: 'https://www.instagram.com/reel/example/' });
  };
  const result = await publishMetaReel({ ...base, channel: 'instagram' }, { fetcher, sleep });
  assert.equal(result.externalPostId, '400'); assert.equal(paths.filter(p => p.endsWith('media_publish')).length, 1);
});
test('Facebook uploads raw bytes with strict host validation, finishes and confirms publication', async () => {
  const phases: string[] = []; let polls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input)); assert.ok(!u.href.includes(credential));
    if (u.hostname === 'rupload.facebook.com') { phases.push('upload'); assert.equal(new Headers(init?.headers).get('Authorization'), `OAuth ${credential}`); assert.equal(init?.redirect, 'error'); assert.deepEqual(Buffer.from(await (init?.body as Blob).arrayBuffer()), base.videoBytes); return ok({ success: true }); }
    const form = new URLSearchParams(String(init?.body || ''));
    if (form.get('upload_phase') === 'start') { phases.push('start'); return ok({ video_id: '500', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/500' }); }
    if (form.get('upload_phase') === 'finish') { phases.push('finish'); assert.equal(form.get('video_state'), 'PUBLISHED'); assert.equal(form.get('description'), base.caption); return ok({ success: true }); }
    phases.push('poll'); return ok({ status: ++polls === 1 ? { video_status: 'processing' } : { video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } } });
  };
  const result = await publishMetaReel({ ...base, channel: 'facebook' }, { fetcher, sleep });
  assert.equal(result.externalPostId, '500'); assert.deepEqual(phases, ['start','upload','finish','poll','poll']);
});
test('malicious Facebook upload URLs and failed uploads never reach finish', async () => {
  for (const badUrl of ['https://evil.test/video-upload/v26.0/500', 'https://rupload.facebook.com/video-upload/v26.0/600', 'https://rupload.facebook.com/video-upload/v26.0/500?x=1', null]) {
    let finishCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const u = new URL(String(input)); const form = new URLSearchParams(String(init?.body || ''));
      if (u.hostname === 'rupload.facebook.com') throw new Error('fake sensitive provider detail');
      if (form.get('upload_phase') === 'finish') finishCalls++;
      return ok({ video_id: '500', upload_url: badUrl || 'https://rupload.facebook.com/video-upload/v26.0/500' });
    };
    await assert.rejects(publishMetaReel({ ...base, channel: 'facebook' }, { fetcher, sleep }), e => e instanceof MetaRequestError && !e.uncertain && !e.message.includes('sensitive'));
    assert.equal(finishCalls, 0);
  }
});
test('unfinished IG container never publishes; lost final response and Facebook pending result block retry', async () => {
  let sends = 0;
  const pending: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith('/media') ? ok({ id: '300' }) : ok({ status_code: 'IN_PROGRESS' });
  await assert.rejects(publishMetaReel({ ...base, channel: 'instagram' }, { fetcher: pending, sleep }), e => e instanceof MetaRequestError && !e.uncertain);
  const lost: typeof fetch = async (input) => { const p = new URL(String(input)).pathname; if (p.endsWith('/media')) return ok({ id: '300' }); if (p.endsWith('/300')) return ok({ status_code: 'FINISHED' }); sends++; throw new Error('lost'); };
  await assert.rejects(publishMetaReel({ ...base, channel: 'instagram' }, { fetcher: lost, sleep }), e => e instanceof MetaRequestError && e.uncertain); assert.equal(sends, 1);
  const facebook: typeof fetch = async (input, init) => { const u = new URL(String(input)); const form = new URLSearchParams(String(init?.body || '')); if (form.get('upload_phase') === 'start') return ok({ video_id:'500', upload_url:'https://rupload.facebook.com/video-upload/v26.0/500' }); if (u.hostname === 'rupload.facebook.com' || form.get('upload_phase') === 'finish') return ok({ success:true }); return ok({ status:{video_status:'processing'} }); };
  await assert.rejects(publishMetaReel({ ...base, channel: 'facebook' }, { fetcher: facebook, sleep }), e => e instanceof MetaRequestError && e.uncertain);
});
test('invalid video input fails before network', async () => {
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;return ok({});};
  await assert.rejects(publishMetaReel({...base,channel:'facebook',videoBytes:Buffer.alloc(0)},{fetcher,sleep}));assert.equal(calls,0);
});
