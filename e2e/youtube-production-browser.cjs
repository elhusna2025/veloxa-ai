const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const artifacts = '/private/tmp/veloxa-youtube-studio-20261122/production-ui';
fs.mkdirSync(artifacts, { recursive: true });
let server, browser;
const watchdog = setTimeout(() => process.exit(124), 50_000);
(async () => {
  const output = path.join(artifacts, 'fixture.js');
  await build({ entryPoints: ['e2e/fixtures/YouTubeProductionPage.tsx'], bundle: true, outfile: output, jsx: 'automatic', platform: 'browser', alias: {
    '@/lib/veloxa-api-client': path.resolve('e2e/fixtures/youtube-production-api.ts'), '@/lib/youtube-upload-client': path.resolve('e2e/fixtures/youtube-production-api.ts'),
  } });
  const css = fs.readdirSync('.next/static/css').filter(name => name.endsWith('.css')).map(name => fs.readFileSync('.next/static/css/' + name, 'utf8')).join('\n');
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/fixture.js')) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(fs.readFileSync(output)); }
    if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#eae4ef"/><circle cx="200" cy="160" r="70" fill="#ad87a2"/><text x="100" y="310" font-size="28">Acuan simulasi</text></svg>'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(8793, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 10_000 });
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const state of ['empty', 'script_review', 'character_review', 'producing', 'retry', 'audio', 'merge', 'attention', 'cancelled']) {
      await page.goto(`http://127.0.0.1:8793/?state=${state}`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Studio video AI', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${state}:${width} overflow`);
      if (state === 'empty') {
        const source = page.getByRole('button', { name: 'Tempel naskah sendiri' });
        await source.focus(); await source.press('Enter');
        const text = page.getByRole('textbox', { name: 'Naskah lengkap' });
        await text.fill('Menit 1 — Awal\nNisa kembali.\nMenit 2 — Akhir\nTokonya sudah buka.');
        assert.equal(await page.getByRole('status').last().innerText(), 'Pilih Video YouTube untuk naskah lebih dari satu menit.');
        const save = page.getByRole('button', { name: 'Simpan untuk ditinjau' });
        assert.ok(await save.isDisabled());
        await page.getByRole('button', { name: 'Video YouTube · 16:9' }).click();
        await page.getByText('2 bagian terbaca · belum disimpan').waitFor();
        assert.ok(await save.isEnabled());
        await page.getByRole('button', { name: 'Susun dari topik' }).click();
        const genre = page.getByRole('combobox', {name: 'Kategori cerita'});
        await genre.focus(); await genre.press('h'); await genre.press('Enter');
        assert.equal(await genre.innerText(), 'Horor');
        await page.getByRole('combobox', { name: 'Suara narator' }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        assert.equal(await page.getByRole('combobox', { name: 'Suara narator' }).innerText(), 'cedar');
        for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Tambah karakter', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Tambah karakter', exact: true }).isDisabled(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      }
      if (state === 'empty') {
        await page.reload({ waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Tempel naskah sendiri' }).click();
        await page.getByRole('textbox', { name: 'Naskah lengkap' }).fill('Menit 1 — Pagi di toko\nNarator: Nisa membuka pintu.\nVisual: Sebuah toko kecil.');
        await page.getByRole('button', { name: 'Simpan untuk ditinjau' }).click();
        await page.getByText('Naskah siap ditinjau', { exact: true }).waitFor();
        await page.getByText('Menit 1 · Pagi di toko').click();
        await page.getByText('Narator: Nisa membuka pintu.').waitFor();
        await page.getByRole('button', { name: 'Edit menit 1' }).click();
        await page.getByRole('textbox', { name: 'Dialog 1 · Narator' }).fill('Pintu toko itu terbuka.');
        await page.getByRole('button', { name: 'Simpan naskah' }).click();
        await page.getByText('Narator: Pintu toko itu terbuka.').waitFor();
        await page.screenshot({ path: `${artifacts}/import-review-${width}.png`, fullPage: true });
      }
      if (state === 'script_review') {
        await page.locator('summary').first().click();
        await page.getByRole('button', { name: 'Edit menit 1', exact: true }).click();
        const note = page.getByRole('textbox', { name: 'Catatan revisi untuk AI' });
        assert.ok(await note.evaluate(el => el === document.activeElement));
        await note.fill('Perjelas pembukaan.');
        await note.press('Tab'); await page.keyboard.press('Enter');
        await page.getByText('Usulan AI · belum disimpan').waitFor();
        assert.ok(await page.getByRole('button', { name: 'Simpan naskah' }).isDisabled());
        await page.getByRole('button', { name: 'Abaikan usulan' }).click();
        await page.getByRole('button', { name: 'Usulkan revisi dengan AI' }).click();
        await page.getByRole('button', { name: 'Gunakan usulan' }).click();
        await page.getByRole('button', { name: 'Simpan naskah' }).click();
        await page.getByRole('heading', {name: '1. Pembukaan baru dari AI'}).waitFor();
      }
      if (state === 'cancelled') {
        const resume = page.getByRole('button', { name: 'Lanjutkan produksi yang sama', exact: true });
        await resume.focus(); await resume.press('Enter');
        await page.getByText('Membuat gambar adegan 11 dari 60', { exact: true }).waitFor();
      }
      if (state === 'retry') { await page.getByText('Menunggu percobaan ulang otomatis', { exact: true }).waitFor(); assert.equal(await page.getByRole('progressbar', { name: 'Bagian produksi yang selesai', exact: true }).getAttribute('max'), '157'); }
      if (state === 'audio') await page.getByText('Membuat suara untuk menit 1 dari 15', { exact: true }).waitFor();
      if (state === 'merge') await page.getByText('Menggabungkan adegan menjadi video akhir', { exact: true }).waitFor();
      await page.screenshot({ path: `${artifacts}/${state}-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ passed: true, widths: [1440, 390], states: ['empty-five-characters', 'script_review', 'character_review', 'producing', 'retry', 'audio', 'merge', 'attention', 'cancelled'], keyboard: 'Voice dropdown Down/Enter; five character maximum', externalWrites: false }, null, 2));
  console.log('Production Studio: desktop, 390px, keyboard and nine states passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.close(); clearTimeout(watchdog); });
