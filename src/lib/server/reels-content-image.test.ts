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

test('Reels photo uses saved colors on real details and leaves exact brand artwork to the compositor', async () => {
  const source = await sharp({ create: { width: 72, height: 128, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const brandPalette = ['#57205C', '#42A970'];
  const copyAreas = {
    headline: { left: 70, top: 375, width: 510, height: 125 },
    accent: { left: 70, top: 520, width: 105, height: 18 },
  };
  let prompt = '';
  await generateSocialPostImage({
    businessName: 'Ruang Belajar', title: 'Tinjau satu soal', hook: 'Lihat bagian yang perlu diulang.',
    cta: 'Simpan untuk nanti', aspectRatio: '9:16', scheduledReelsPhotoOnly: true,
    brandPalette, hasOriginalLogo: true, scheduledReelsCopyBounds: copyAreas,
  }, { imageClient: { images: { async generate(request) {
    prompt = request.prompt;
    return { data: [{ b64_json: source.toString('base64') }] };
  } } } });

  assert.ok(prompt.includes(JSON.stringify(brandPalette)));
  assert.ok(prompt.includes(JSON.stringify(copyAreas)));
  assert.match(prompt, /Repeat the saved brand colors visibly in physical details/);
  assert.match(prompt, /selected business context, scene direction and visual references determine the people, setting, objects and materials/);
  assert.match(prompt, /both bottom corners uncluttered.*brand sweeps added by the app/);
  assert.match(prompt, /softly lit pale surfaces.*extra margin.*slow camera pans and zooms/);
  assert.match(prompt, /Do not draw captions.*logos.*sweeps, underlines/);
  assert.match(prompt, /"reservedLogo"/);
  assert.doesNotMatch(prompt, /Simpan untuk nanti/);
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
