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
      model: 'gpt-image-2.5-sunburst',
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
