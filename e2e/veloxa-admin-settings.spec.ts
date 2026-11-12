import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { AdminSettingsUpdate, AdminSettingsView } from '../src/lib/admin-settings';

/** In a disposable copy of the app, copy e2e/fixtures/VeloxaAdminTestPage.tsx to
 * src/app/qa-super-admin/page.tsx. Start Next there on a local test port and set
 * VELOXA_ADMIN_FIXTURE_URL=http://127.0.0.1:<port>/qa-super-admin/ before running
 * node --import tsx e2e/veloxa-admin-settings.spec.ts.
 * Every admin request is intercepted, so the test never writes live data.
 */
async function run() {
  const fixture = process.env.VELOXA_ADMIN_FIXTURE_URL;
  if (!fixture || !['localhost', '127.0.0.1'].includes(new URL(fixture).hostname)) {
    throw new Error('Set VELOXA_ADMIN_FIXTURE_URL to the isolated local Super Admin fixture.');
  }
  const artifacts = process.env.VELOXA_E2E_ARTIFACT_DIR || '/tmp/veloxa-admin-settings-e2e';
  mkdirSync(artifacts, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    ['/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromium.executablePath()].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors: string[] = [];
    const writes: AdminSettingsUpdate[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const now = Date.now();
    const ws = { id: 'ws_berez', name: 'Berez ERP', plan: 'Veloxa Free Trial', onboarded: true };
    const defaults = { scriptModel: 'gpt-6-luna', imageModel: 'gpt-image-2.6-sunburst', voiceModel: 'gpt-realtime-2.1-mini' };
    const availableModels = { scriptModel: ['gpt-6-luna', 'gpt-6.1-sol'], imageModel: [defaults.imageModel], voiceModel: [defaults.voiceModel] };
    const initialGlobal = {
      scope: 'global' as const, revision: 1, defaultModels: defaults, effectiveModels: defaults, models: {}, availableModels,
      plans: [{ id: 'free_trial' as const, label: 'Veloxa Free Trial', dailyDraftLimit: 6, dailyPublicationLimit: null, monthlyPublicationLimit: 20 }],
      audit: [{ id: 'rev-1', actor: 'Operator QA', action: 'update' as const, reason: 'Setelan uji awal.', at: now, revision: 1,
        changes: ['Veloxa Free Trial · Publikasi per bulan: 10 → 20'] }],
    };
    let global: Extract<AdminSettingsView, { scope: 'global' }> = initialGlobal;
    let workspace: Extract<AdminSettingsView, { scope: 'workspace' }> = {
      scope: 'workspace', workspaceId: ws.id, workspaceName: ws.name, revision: 0,
      defaultModels: defaults, effectiveModels: defaults, models: { voiceModel: 'voice-previous' }, availableModels, quota: {}, audit: [],
      effectiveQuota: { dailyDraftLimit: 6, dailyPublicationLimit: null, monthlyPublicationLimit: 20 },
    };
    let conflict = true;

    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== new URL(fixture).origin) return route.abort();
      if (url.pathname === '/api/veloxa/admin/settings/') {
        if (req.method() === 'GET') return route.fulfill({ json: url.searchParams.get('workspaceId') === ws.id ? workspace : global });
        assert.equal(req.method(), 'PATCH');
        const body = req.postDataJSON() as AdminSettingsUpdate;
        writes.push(body);
        if (conflict) {
          conflict = false;
          return route.fulfill({ status: 409, json: { error: 'Revisi berubah. Muat ulang pengaturan.' } });
        }
        const current = body.workspaceId ? workspace : global;
        assert.equal(body.expectedRevision, current.revision);
        const revision = current.revision + 1;
        const record = {
          id: 'rev-' + revision, actor: 'Operator QA', action: body.restoreRevision === undefined ? 'update' as const : 'restore' as const,
          reason: body.reason, at: now, revision, restoredFrom: body.restoreRevision,
        };
        if (body.workspaceId) {
          assert.equal(body.workspaceId, ws.id);
          workspace = { ...workspace, revision, models: body.models ?? workspace.models,
            quota: body.quota ?? workspace.quota, audit: [record, ...workspace.audit],
            effectiveQuota: { ...workspace.effectiveQuota, ...body.quota } };
        } else {
          const updatedPlan = body.plans?.[0];
          const plan = body.restoreRevision !== undefined ? initialGlobal.plans[0] :
            updatedPlan ? { ...updatedPlan, label: initialGlobal.plans[0].label } : global.plans[0];
          const models = body.restoreRevision !== undefined ? initialGlobal.models : body.models ?? global.models;
          global = { ...global, revision, plans: [plan], models, effectiveModels: { ...defaults, ...models }, audit: [record, ...global.audit] };
        }
        return route.fulfill({ json: { revision } });
      }
      if (url.pathname === '/api/veloxa/admin/') {
        const view = url.searchParams.get('view');
        if (view === 'workspaces') return route.fulfill({ json: { items: [ws], cursor: null } });
        if (view === 'workspace') return route.fulfill({ json: {
          workspace: ws, publication: { used: 2, limit: 20, month: '2026-11', dailyUsed: 1, dailyLimit: 3, day: '2026-11-13' },
          generation: { mode: 'standard', dailyLimit: 6, used: 3, day: '2026-11-13' },
          businesses: [], unassigned: [], profileStatus: 'ready', jobs: [],
          pauseAudit: [{ id: 'paused', actor: 'Operator QA', reason: 'Periksa konfirmasi Meta.', at: now, businessName: 'Berez ERP', processing: true }],
        } });
        return route.fulfill({ json: { activeWorkspaces: 1, publishedToday: 0, publishedLowerBound: false, activityPartial: false,
          recovering: 0, attention: 0, actions: [], blocked: [], upcoming: [], scheduler: { schedulerReady: true, lastTickAt: now } } });
      }
      return route.continue();
    });

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.goto(fixture, { waitUntil: 'domcontentloaded' });
    await page.getByText('Workspace aktif', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pengaturan AI & kuota', exact: true }).click();
    await page.getByText('Revisi 1 tersimpan', { exact: true }).waitFor();
    await page.getByText('Veloxa Free Trial · Publikasi per bulan: 10 → 20', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Tinjau perubahan' }).isDisabled(), true);
    await page.screenshot({ path: path.join(artifacts, 'pengaturan-admin-desktop.png'), fullPage: true });
    const script = page.getByRole('combobox', { name: 'Model naskah & caption' });
    await script.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('listbox').waitFor();
    assert.equal(await page.getByRole('option', { name: 'gpt-6.2', exact: true }).count(), 0);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.getByText('Perubahan belum disimpan').waitFor();
    await page.getByLabel('Publikasi per bulan', { exact: true }).fill('1000001');
    assert.equal(await page.getByRole('button', { name: 'Tinjau perubahan' }).isDisabled(), true);
    await page.getByLabel('Publikasi per bulan', { exact: true }).fill('24');
    await page.getByLabel('Publikasi per hari', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Buang perubahan yang belum disimpan?' });
    await discard.waitFor();
    await page.keyboard.press('Escape');
    await discard.waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Publikasi per bulan', { exact: true }).inputValue(), '24');
    assert.equal(writes.length, 0);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await overflow(), false);
    await script.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('listbox');
    await menu.waitFor();
    const menuBounds = await menu.boundingBox();
    assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await script.evaluate(element => document.activeElement === element), true);
    const review = page.getByRole('button', { name: 'Tinjau perubahan' });
    await review.click();
    const confirmation = page.getByRole('dialog', { name: 'Simpan pengaturan?' });
    await confirmation.waitFor();
    const commit = confirmation.getByRole('button', { name: 'Simpan pengaturan', exact: true });
    assert.equal(await commit.isDisabled(), true);
    await confirmation.getByLabel('Alasan perubahan').fill('Uji kapasitas paket.');
    await page.screenshot({ path: path.join(artifacts, 'konfirmasi-admin-390.png') });
    await commit.click();
    await confirmation.getByRole('alert').filter({ hasText: 'Revisi berubah' }).waitFor();
    assert.equal(await confirmation.getByLabel('Alasan perubahan').inputValue(), 'Uji kapasitas paket.');
    await commit.click();
    await page.getByText('Pengaturan tersimpan.', { exact: true }).waitFor();
    await page.getByText('Revisi 2 tersimpan', { exact: true }).waitFor();
    assert.deepEqual(writes[1], { expectedRevision: 1, reason: 'Uji kapasitas paket.', models: { scriptModel: 'gpt-6.1-sol' },
      plans: [{ id: 'free_trial', dailyDraftLimit: 6, dailyPublicationLimit: 4, monthlyPublicationLimit: 24 }] });
    await page.getByRole('button', { name: 'Pulihkan revisi 1', exact: true }).click();
    const restore = page.getByRole('dialog', { name: 'Pulihkan pengaturan?' });
    await restore.getByLabel('Alasan perubahan').fill('Kembali ke paket awal.');
    await restore.getByRole('button', { name: 'Pulihkan pengaturan', exact: true }).click();
    await page.getByText('Revisi 3 tersimpan', { exact: true }).waitFor();
    assert.deepEqual(writes[2], { expectedRevision: 2, reason: 'Kembali ke paket awal.', restoreRevision: 1 });
    await page.getByText('Revisi 3 · Pemulihan dari revisi 1', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Detail Berez ERP', exact: true }).click();
    await page.getByRole('heading', { name: 'Riwayat jeda oleh admin' }).waitFor();
    await page.getByText('Periksa konfirmasi Meta.', { exact: true }).waitFor();
    await page.getByText('Kuota publikasi harian', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pengaturan AI & kuota workspace' }).click();
    await page.getByRole('heading', { name: 'Pengaturan workspace', exact: true }).waitFor();
    await page.getByText('Revisi 0 tersimpan', { exact: true }).waitFor();
    await page.getByText(`Model tersimpan sudah tidak tersedia. Model yang sedang digunakan: ${defaults.voiceModel}.`).waitFor();
    assert.equal(await page.getByLabel('Pembuatan draf per hari', { exact: true }).inputValue(), '');
    const monthly = page.getByLabel('Publikasi per bulan', { exact: true });
    await monthly.fill('30');
    await page.getByRole('button', { name: 'Batalkan perubahan' }).click();
    await discard.getByRole('button', { name: 'Buang perubahan', exact: true }).click();
    await page.getByText('Revisi 0 tersimpan', { exact: true }).waitFor();
    assert.equal(await monthly.inputValue(), '');
    assert.equal(writes.length, 3);
    await page.getByLabel('Tanpa batas pembuatan draf').check();
    await page.getByLabel('Publikasi per hari', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Tinjau perubahan' }).click();
    await confirmation.getByLabel('Alasan perubahan').fill('Pengujian kuota Berez.');
    await commit.click();
    await page.getByText('Revisi 1 tersimpan', { exact: true }).waitFor();
    assert.deepEqual(writes[3], { workspaceId: ws.id, expectedRevision: 0, reason: 'Pengujian kuota Berez.',
      quota: { dailyDraftLimit: null, dailyPublicationLimit: 0 } });
    assert.equal(await overflow(), false);
    await page.screenshot({ path: path.join(artifacts, 'pengaturan-workspace-390.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS pengaturan platform/workspace, perubahan belum disimpan, konflik revisi, pemulihan dan audit, keyboard, desktop dan 390 px.');
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
