import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateSocialPostImage } from './content-image';
test('Reels scene requests portrait Sunburst with supplied subject and yields JPEG720x1280',async()=>{
  const source=await sharp({create:{width:720,height:1280,channels:3,background:'#eeeeee'}}).jpeg().toBuffer();let request:Record<string,unknown>|undefined;
  const imageClient={images:{generate:async(p:Record<string,unknown>)=>{request=p;return{data:[{b64_json:source.toString('base64')}]};}}};
  const image=await generateSocialPostImage({businessName:'Brand',title:'Satu langkah',hook:'Coba latihan terarah.',cta:'Simpan',aspectRatio:'9:16',visualDirection:'Pelajar berlatih dengan catatan.'},{imageClient});
  assert.equal(request?.model,'gpt-image-2.6-sunburst');assert.equal(request?.size,'1008x1792');assert.match(String(request?.prompt),/Pelajar berlatih dengan catatan/);const metadata=await sharp(image).metadata();assert.equal(metadata.width,720);assert.equal(metadata.height,1280);assert.equal(metadata.format,'jpeg');
});

test('Reels opening frames the series topic and reserves the full motion area for integrated typography', async () => {
  const source = await sharp({ create: { width: 72, height: 128, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const brandPalette = ['#57205C', '#42A970'];
  const copyAreas = {
    headline: { left: 70, top: 375, width: 510, height: 125 },
    accent: { left: 70, top: 520, width: 105, height: 18 },
  };
  const copySweeps = {
    logo: { left: 55, top: 200, width: 220, height: 130 },
    headline: { left: 55, top: 330, width: 600, height: 225 },
    accent: { left: 55, top: 465, width: 170, height: 120 },
  };
  let prompt = '';
  await generateSocialPostImage({
    businessName: 'Ruang Belajar', title: 'Tinjau satu soal', hook: 'Lihat bagian yang perlu diulang.',
    cta: 'Simpan untuk nanti', aspectRatio: '9:16', scheduledReelsPhotoOnly: true,
    brandPalette, hasOriginalLogo: true, scheduledReelsCopyBounds: copyAreas,
    reelsPhotoLayout: { copySweeps, sceneNumber: 1, seriesDirection: 'Berlatih menganalisis langkah pengerjaan soal.' },
  }, { imageClient: { images: { async generate(request) {
    prompt = request.prompt;
    return { data: [{ b64_json: source.toString('base64') }] };
  } } } });

  assert.ok(prompt.includes(JSON.stringify(brandPalette)));
  assert.ok(prompt.includes(JSON.stringify(copyAreas)));
  assert.ok(prompt.includes(JSON.stringify(copySweeps)));
  assert.match(prompt, /Repeat the saved brand colors visibly in physical details/);
  assert.match(prompt, /selected business context, scene direction and visual references determine the people, setting, objects and materials/);
  assert.match(prompt, /both bottom corners uncluttered.*brand sweeps added by the app/);
  assert.match(prompt, /one continuous natural surface through the entire headline region/);
  assert.match(prompt, /x 5–61%, y 10–31%\. Stage every focal detail fully below y 31%/);
  assert.match(prompt, /extra margin.*slow camera pans and zooms/);
  assert.match(prompt, /This opening is the cover of the story\. Show the whole topic/);
  assert.match(prompt, /Keep the four photos in one visual world/);
  assert.match(prompt, /Berlatih menganalisis langkah pengerjaan soal/);
  assert.match(prompt, /Do not draw captions.*logos.*sweeps, underlines/);
  assert.match(prompt, /"reservedLogo"/);
  assert.doesNotMatch(prompt, /Simpan untuk nanti/);
});

test('Reels photo repair reserves separate final copy and preserves a dark brief', async () => {
  const source = await sharp({ create: { width: 72, height: 128, channels: 3, background: '#222222' } }).jpeg().toBuffer();
  const copySweeps = {
    headline: { left: 55, top: 330, width: 600, height: 225 },
    cta: { left: 67, top: 1325, width: 520, height: 140 },
    website: { left: 75, top: 1490, width: 450, height: 55 },
  };
  let prompt = '';
  await generateSocialPostImage({
    businessName: 'Panggung Selatan', title: 'Panggung Menjelang Malam',
    hook: 'Dengarkan set akustik setelah matahari terbenam.', cta: 'Lihat jadwal pertunjukan',
    aspectRatio: '9:16', scheduledReelsPhotoOnly: true, scheduledArtworkRepair: true,
    hasOriginalScreenshot: true,
    reelsPhotoLayout: { copySweeps, sceneNumber: 4, seriesDirection: 'Panggung akustik malam hari.' },
  }, { imageClient: { images: { async generate(request) {
    prompt = request.prompt;
    return { data: [{ b64_json: source.toString('base64') }] };
  } } } });

  assert.match(prompt, /Closing copy region: x 6–55%, y 69–81%/);
  assert.match(prompt, /evenly dark natural surface for light type in an explicitly dark scene/);
  assert.match(prompt, /Recompose from a wider viewpoint.*outside BOTH the headline and closing copy regions/);
  assert.match(prompt, /"reservedScreenshot"/);
  assert.doesNotMatch(prompt, /This opening is the cover|Lihat jadwal pertunjukan/);
});

test('Reels closing links grouped under the headline reserve the same natural surface', async () => {
  const source = await sharp({ create: { width: 72, height: 128, channels: 3, background: 'white' } }).jpeg().toBuffer();
  let prompt = '';
  await generateSocialPostImage({
    businessName: 'Panggung Selatan', title: 'Sampai Jumpa di Panggung', hook: 'Simpan jadwal pertunjukan.',
    cta: 'Lihat jadwal', aspectRatio: '9:16', scheduledReelsPhotoOnly: true,
    reelsPhotoLayout: { sceneNumber: 4, copySweeps: {
      headline: { left: 70, top: 340, width: 640, height: 140 },
      cta: { left: 70, top: 580, width: 300, height: 60 },
      website: { left: 70, top: 660, width: 360, height: 60 },
    } },
  }, { imageClient: { images: { async generate(request) {
    prompt = request.prompt;
    return { data: [{ b64_json: source.toString('base64') }] };
  } } } });
  assert.match(prompt, /Headline region.*x 6–66%, y 17–38%/);
  assert.doesNotMatch(prompt, /Closing copy region:/);
});

test('Reels scene content follows the business brief for a café and an event', async () => {
  const photo = await sharp({ create: { width: 72, height: 128, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const briefs = [
    { title: 'Kopi Susu Gula Aren', visualDirection: 'Gelas kopi dingin di meja kayu kafe.', brandPalette: ['#563A2E', '#F37851'] },
    { title: 'Siap di Garis Start', visualDirection: 'Peserta lari melakukan pemanasan di area start.', brandPalette: ['#163A59', '#43BAC1'] },
  ];
  for (const brief of briefs) {
    let prompt = '';
    await generateSocialPostImage({
      ...brief, businessName: 'Bisnis Aktif', hook: 'Lihat kegiatan hari ini.', cta: '',
      aspectRatio: '9:16', scheduledReelsPhotoOnly: true,
    }, { imageClient: { images: { async generate(request) {
      prompt = request.prompt;
      return { data: [{ b64_json: photo.toString('base64') }] };
    } } } });
    assert.ok(prompt.includes(brief.visualDirection));
    assert.ok(prompt.includes(JSON.stringify(brief.brandPalette)));
    assert.doesNotMatch(prompt, /notebook|classroom|school supplies/i);
  }
});
