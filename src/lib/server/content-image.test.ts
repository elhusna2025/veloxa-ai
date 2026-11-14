import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { ApiError } from './http';
import { generateSocialPostImage } from './content-image';

test('scene-only provider receives scene data without asking AI to paint final text, logo or product UI',async()=>{
 const source=await sharp({create:{width:64,height:80,channels:3,background:'white'}}).jpeg().toBuffer();let prompt='';
 await generateSocialPostImage({businessName:'Berez ERP',title:'Stok lebih rapi',hook:'Pencatatan persediaan',cta:'Kenali Berez ERP',sceneOnly:true,referenceImages:[source],sceneReferenceLabels:['Ref 1: Model Berez']},{imageClient:{images:{generate:async()=>{throw Error('wrong route');},edit:async request=>{prompt=request.prompt;assert.equal(request.image.length,1);return{data:[{b64_json:source.toString('base64')}]};}}}});
 assert.match(prompt,/Output ONLY the photographic scene/);assert.match(prompt,/layered separately/);assert.match(prompt,/Ref 1: Model Berez/);assert.ok(!prompt.includes('Render only the supplied business name'));
});

test('carousel sends real screenshot pixels to the image editor and leaves the hero clear of text', async () => {
 const jpeg = await createJpegFixture();
 let called = false;
 await generateSocialPostImage({
  businessName:'Cendekia AI',title:'Latihan TKA',hook:'Berlatih bersama',cta:'',
  sceneOnly:true,carouselSlide:true,screenshotReferenceLabels:['Ref 3: Tryout TKA'],
  sceneReferenceLabels:['Ref 3: Tryout TKA'],referenceImages:[jpeg],
  slideReferenceDirection:'Gunakan Ref 3 di layar laptop guru.',
 },{imageClient:{images:{generate:async()=>{throw Error('Screenshot must use edit');},edit:async request=>{
  called=true;
  assert.match(request.prompt,/one continuous edge-to-edge portrait photograph/);
  assert.match(request.prompt,/bright natural lighting/);
  assert.match(request.prompt,/copy below the photo/);
  assert.match(request.prompt,/Ref 3: Tryout TKA/);
  assert.match(request.prompt,/Gunakan Ref 3 di layar laptop guru/);
  assert.deepEqual(Buffer.from(await request.image[0].arrayBuffer()),jpeg);
  return {data:[{b64_json:jpeg.toString('base64')}]};
 }}}});
 assert.equal(called,true);
});

test('editorial carousel requests integrated exact copy, actual Ref bytes and no slide badges', async () => {
 const jpeg = await createJpegFixture();
 const edit = async (request: any) => {
  assert.equal(request.model,'gpt-image-2.6-sunburst');
  assert.match(request.prompt,/single editorial composition/);
  assert.match(request.prompt,/Do not put a black or white wash/);
  assert.match(request.prompt,/No slide numbers, swipe cues/);
  assert.match(request.prompt,/"headline":"Catat Transaksi"/);
  assert.match(request.prompt,/"cta":""/);
  assert.match(request.prompt,/Ref 3: Dashboard Berez/);
  assert.match(request.prompt,/Reserve a quiet blank area for the original logo/);
  assert.deepEqual(Buffer.from(await request.image[0].arrayBuffer()),jpeg);
  return {data:[{b64_json:jpeg.toString('base64')}]};
 };
 await generateSocialPostImage({businessName:'Berez ERP',title:'Catat Transaksi',hook:'Pantau penjualan dan pembelian.',cta:'',carouselSlide:true,hasOriginalLogo:true,referenceImages:[jpeg],sceneReferenceLabels:['Ref 3: Dashboard Berez'],screenshotReferenceLabels:['Ref 3: Dashboard Berez']},{imageClient:{images:{edit,generate:async()=>{throw Error('Image editing required');}}}});
});

const params = {
  businessName: 'Kedai Senja',
  title: 'Ruang untuk jeda',
  hook: 'Nikmati waktu tenang di tengah hari yang sibuk.',
  cta: 'Kunjungi kami hari ini',
};

async function createJpegFixture(): Promise<Buffer> {
  return sharp({
    create: {
      width: 320,
      height: 400,
      channels: 3,
      background: { r: 230, g: 224, b: 215 },
    },
  }).jpeg().toBuffer();
}

test('Ulinz single post requests integrated copy, readable neon lighting and the original logo reservation', async () => {
 const artwork = await createJpegFixture();
 let prompt = '';
 await generateSocialPostImage({
  businessName:'Ulinz Cafe', title:'Turnamen Mobile Legends', hook:'Adu strategi, seru bareng di Ulinz!',
  cta:'Pelajari selengkapnya', website:'ulinz.com', editorialSinglePost:true, hasOriginalLogo:true,
  brandPalette:['#028CFF','#DF20DF'],
 },{imageClient:{images:{generate:async request => {
  prompt = request.prompt;
  return {data:[{b64_json:artwork.toString('base64')}]};
 }}}});
 assert.match(prompt, /single social post.*single editorial composition/);
 assert.match(prompt, /black or white wash/);
 assert.match(prompt, /without a button or a background card/);
 assert.match(prompt, /neon-lit settings.*faces/);
 assert.match(prompt, /app will add the logo/);
 for (const value of ['Turnamen Mobile Legends', 'ulinz.com', '#028CFF', '#DF20DF']) assert.ok(prompt.includes(value));
});

test('without references the provider receives actual business/subject context and a contextual visual brief',async()=>{
 const fixture=await createJpegFixture();let prompt='';let calls=0;
 const businessContext={description:'Berez ERP mengelola stok dan penjualan.',audience:'Pemilik usaha',topic:'Stok yang tercatat rapi'};
 await generateSocialPostImage({...params,businessName:'Berez ERP',businessContext,visualDirection:'Tim memeriksa persediaan di ruang kerja modern.'},{imageClient:{images:{generate:async request=>{calls++;prompt=request.prompt;return{data:[{b64_json:fixture.toString('base64')}]};}}}});
 assert.equal(calls,1);assert.ok(prompt.includes(JSON.stringify(businessContext)));assert.match(prompt,/high-quality photography or a purposeful editorial illustration/);assert.match(prompt,/Tim memeriksa persediaan/);assert.match(prompt,/without fabricated product UI/);assert.ok(!prompt.includes('Use neutral abstract artwork only'));assert.ok(!prompt.includes('Use a restrained neutral palette'));
 await assert.rejects(generateSocialPostImage({...params,businessContext:{...businessContext,description:'x'.repeat(2501)}},{imageClient:{images:{generate:async()=>{calls++;return{data:[]};}}}}),error=>error instanceof ApiError&&error.status===400);assert.equal(calls,1);
});

test('explicit saved palette overrides reference decoration colors while protecting products; legacy omits override',async()=>{
 const image=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();let requests:string[]=[];
 const imageClient={images:{generate:async(request:any)=>{requests.push(request.prompt);return{data:[{b64_json:image.toString('base64')}]};},edit:async(request:any)=>{requests.push(request.prompt);return{data:[{b64_json:image.toString('base64')}]};}}};
 await generateSocialPostImage({...params,brandPalette:['#167D8D','#FCAB20']},{imageClient});
 await generateSocialPostImage({...params,brandPalette:['#167D8D','#FCAB20'],referenceImages:[image]},{imageClient});
 assert.ok(requests.every(prompt=>prompt.includes('#167D8D')&&prompt.includes('takes priority over conflicting reference colors')&&prompt.includes('Preserve original product, logo and software-interface colors')));
 await generateSocialPostImage(params,{imageClient});assert.ok(!requests[2].includes('Explicit saved brand palette'));
 await assert.rejects(generateSocialPostImage({...params,brandPalette:['not-a-color']},{imageClient}),error=>error instanceof ApiError&&error.status===400);assert.equal(requests.length,3);
});

test('multi-reference memakai images.edit Sunburst2.6 dengan file asli berurutan dan arahan komposisi', async () => {
 const references=await Promise.all(['#cc3344','#2277aa','#aabbcc'].map(background=>sharp({create:{width:64,height:64,channels:3,background}}).jpeg().toBuffer()));
 const output=await createJpegFixture();let editCalls=0;let generateCalls=0;
 const image=await generateSocialPostImage({...params,referenceImages:references,referenceInstruction:'Orang dari foto1 mempresentasikan aplikasi foto2 di ruang rapat foto3.'},{imageClient:{images:{generate:async()=>{generateCalls++;throw new Error('wrong route');},edit:async request=>{editCalls++;assert.equal(request.model,'gpt-image-2.6-sunburst');assert.equal(request.image.length,3);assert.match(request.prompt,/mempresentasikan aplikasi/);for(let index=0;index<3;index++){assert.deepEqual(Buffer.from(await request.image[index].arrayBuffer()),references[index]);assert.equal(request.image[index].name,`reference-${index+1}.jpg`);}return{data:[{b64_json:output.toString('base64')}]};}}}});
 assert.equal(editCalls,1);assert.equal(generateCalls,0);assert.equal((await sharp(image).metadata()).width,1080);
});
test('Sunburst2.6 edit accepts 4,5 and6 chosen image files in one request',async()=>{
 const image=await createJpegFixture();
 for(const count of [4,5,6]){let edits=0;await generateSocialPostImage({...params,referenceImages:Array.from({length:count},()=>image)},{imageClient:{images:{generate:async()=>{throw Error('References must use edit');},edit:async request=>{edits++;assert.equal(request.image.length,count);assert.equal(request.model,'gpt-image-2.6-sunburst');return{data:[{b64_json:image.toString('base64')}]};}}}});assert.equal(edits,1);}
});

test('failed reference editing never silently drops photos or switches to text-only generation', async () => {
 const reference=await createJpegFixture();let generated=0;
 await assert.rejects(generateSocialPostImage({...params,referenceImages:[reference]},{imageClient:{images:{generate:async()=>{generated++;return{data:[]};},edit:async()=>{throw new Error('PRIVATE_EDIT_RESPONSE');}}}}),error=>error instanceof ApiError&&!error.message.includes('PRIVATE_EDIT_RESPONSE'));
 assert.equal(generated,0);
});

test('meminta model yang ditentukan dan menghasilkan JPEG berukuran 1080x1350', async () => {
  const fixture = await createJpegFixture();
  let request: Record<string, unknown> | undefined;
  const imageClient = {
    images: {
      async generate(value: Record<string, unknown>) {
        request = value;
        return { data: [{ b64_json: fixture.toString('base64') }] };
      },
    },
  };

  const result = await generateSocialPostImage(params, { imageClient });
  const metadata = await sharp(result).metadata();

  assert.deepEqual(
    Object.fromEntries(Object.entries(request || {}).filter(([key]) => key !== 'prompt')),
    {
      model: 'gpt-image-2.6-sunburst',
      n: 1,
      size: '1024x1280',
      quality: 'medium',
      output_format: 'jpeg',
    },
  );
  const prompt = String(request?.prompt);
  for (const value of Object.values(params)) assert.ok(prompt.includes(value));
  assert.match(prompt, /Do not invent or imply claims, contact details, products, services, locations, prices/);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
});

test('memakai model gambar pilihan pada generasi dan edit referensi', async () => {
  const fixture = await createJpegFixture();
  const requestedModels: string[] = [];
  const imageClient = {
    images: {
      generate: async ({ model }: { model: string }) => {
        requestedModels.push(model);
        return { data: [{ b64_json: fixture.toString('base64') }] };
      },
      edit: async ({ model }: { model: string }) => {
        requestedModels.push(model);
        return { data: [{ b64_json: fixture.toString('base64') }] };
      },
    },
  };
  const model = 'gpt-image-2.5-sunburst';
  await generateSocialPostImage(params, { imageClient, model });
  await generateSocialPostImage({ ...params, referenceImages: [fixture] }, { imageClient, model });
  assert.deepEqual(requestedModels, [model, model]);
});

test('menolak respons gambar yang hilang atau bukan base64 JPEG valid', async () => {
  const invalidClients = [
    { images: { async generate() { return {}; } } },
    { images: { async generate() { return { data: [{ b64_json: 'bukan-gambar' }] }; } } },
  ];

  for (const imageClient of invalidClients) {
    await assert.rejects(
      generateSocialPostImage(params, { imageClient }),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_social_image_response',
    );
  }
});

test('menolak payload non-gambar base64 besar dengan ApiError tersanitasi', async () => {
  const encoded = Buffer.alloc(5 * 1024 * 1024, 1).toString('base64');
  const imageClient = { images: { async generate() { return { data: [{ b64_json: encoded }] }; } } };

  await assert.rejects(
    generateSocialPostImage(params, { imageClient }),
    (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === 'invalid_social_image_response',
  );
});

test('menyamarkan kegagalan provider tanpa membocorkan detail error', async () => {
  const imageClient = {
    images: {
      async generate() {
        throw new Error('Authorization: sk-secret-provider-detail');
      },
    },
  };

  await assert.rejects(
    generateSocialPostImage(params, { imageClient }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'social_image_unavailable');
      assert.ok(!error.message.includes('sk-secret-provider-detail'));
      return true;
    },
  );
});
