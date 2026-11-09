import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { ApiError } from './http';
import { generateSocialPostImage } from './content-image';

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
