import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Real browser + local Next server. Firebase rejection responses are isolated test fixtures.
 * This suite never authorizes Meta, creates a real account, or sends a real post.
 */
async function run() {
  const base = process.env.VELOXA_BASE_URL || 'http://127.0.0.1:3035';
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This suite only runs against a local server.');
  const artifacts = process.env.VELOXA_E2E_ARTIFACT_DIR || '/tmp/veloxa-browser-e2e';
  mkdirSync(artifacts, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/usr/bin/chromium', '/usr/bin/google-chrome', chromium.executablePath()].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const authRequests: string[] = [];
  let mode: 'login' | 'register' | 'reset' = 'login';
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      authRequests.push(url.pathname);
      const message = mode === 'login' ? 'INVALID_LOGIN_CREDENTIALS' : mode === 'register' ? 'EMAIL_EXISTS' : 'OPERATION_NOT_ALLOWED';
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 400, message } }) });
    }
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  const check = async (name: string, action: () => Promise<void>) => {
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }); }
  };
  try {
    await check('landing renders on desktop and mobile without horizontal overflow', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('veloxa-sales-landing-page').waitFor();
      await page.screenshot({ path: path.join(artifacts, 'landing-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId('veloxa-mobile-welcome').waitFor();
      await page.locator('#veloxa-landing-title').waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(artifacts, 'landing-mobile.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    });
    await check('a forged administrator localStorage record cannot open a workspace', async () => {
      await page.evaluate(() => localStorage.setItem('veloxa_prod_auth_session_v2', JSON.stringify({ uid: 'forged-admin', email: 'sosrospg@gmail.com', isSuperAdmin: true, role: 'admin', onboardingCompleted: true })));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('veloxa-mobile-welcome').waitFor();
      assert.equal(await page.getByTestId('super-admin-dashboard').isVisible(), false);
    });
    await check('wrong password remains on login and never triggers registration', async () => {
      mode = 'login'; authRequests.length = 0;
      await page.goto(`${base}/login/`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-client-ready=true]').waitFor();
      await page.getByTestId('login-email-input').fill('browser-test@example.test');
      await page.getByTestId('login-password-input').fill('wrong-password');
      await page.getByTestId('login-submit-btn').click();
      await page.locator('main [role=alert]').waitFor();
      assert.match(page.url(), /\/login\/?$/);
      assert.ok(authRequests.some(value => value.includes('signInWithPassword')));
      assert.ok(authRequests.every(value => !value.includes('signUp')));
      await page.screenshot({ path: path.join(artifacts, 'login-error-mobile.png') });
    });
    await check('registration requires consent and matching passwords before contacting Firebase', async () => {
      mode = 'register'; authRequests.length = 0;
      await page.goto(`${base}/register/`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-client-ready=true]').waitFor();
      await page.getByTestId('register-name-input').fill('Browser Test');
      await page.getByTestId('register-email-input').fill('browser-test@example.test');
      await page.getByTestId('register-password-input').fill('valid-length-password');
      const confirmation = page.getByTestId('register-confirm-password-input');
      const consent = page.getByTestId('register-legal-checkbox');
      const submit = page.getByTestId('register-submit-btn');
      const google = page.getByTestId('register-google-oauth-btn');
      const alert = page.locator('main [role=alert]');
      await confirmation.fill('different-password');
      assert.equal(await submit.isDisabled(), true);
      assert.equal(await google.isDisabled(), true);
      await consent.check();
      assert.equal(await google.isEnabled(), true);
      await submit.click();
      await alert.filter({ hasText: 'Kata sandi tidak cocok' }).waitFor();
      assert.equal(await confirmation.evaluate(input => input === document.activeElement), true);
      assert.deepEqual(authRequests, []);
      await confirmation.fill('valid-length-password');
      await consent.uncheck();
      assert.equal(await submit.isDisabled(), true);
      await consent.check();
      await submit.click();
      await alert.filter({ hasText: 'Email ini sudah terdaftar' }).waitFor();
      assert.match(page.url(), /\/register\/?$/);
      assert.ok(authRequests.some(value => value.includes('signUp')));
      assert.ok(authRequests.every(value => !value.includes('signInWithPassword')));
    });
    await check('reset transport failure shows an error rather than a delivery confirmation', async () => {
      mode = 'reset';
      await page.goto(`${base}/forgot-password/`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-client-ready=true]').waitFor();
      await page.locator('input[type="email"]').fill('browser-test@example.test');
      await page.locator('button[type="submit"]').click();
      await page.locator('main [role=alert]').waitFor();
      assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
      assert.equal(await page.getByText(/instruksi reset akan dikirim ke/i).count(), 0);
    });
    await check('real server APIs reject anonymous requests and invalid provider callbacks', async () => {
      for (const endpoint of ['meta/start', 'content', 'publish']) {
        const response = await context.request.post(`${base}/api/veloxa/${endpoint}`, { data: { workspaceId: 'test-workspace', draftId: 'draft_test', topic: 'Test' } });
        assert.equal(response.status(), endpoint === 'publish' ? 400 : 401); // strict schema rejects extra input before authentication
        assert.equal((await response.json()).ok, false);
      }
      const publish = await context.request.post(`${base}/api/veloxa/publish`, { data: { workspaceId: 'test-workspace', draftId: 'draft_test' } });
      assert.equal(publish.status(), 401);
      const ads = await context.request.get(`${base}/api/veloxa/meta-ads/?workspaceId=test-workspace&businessId=primary`);
      assert.equal(ads.status(), 401);
      const prepare = await context.request.post(`${base}/api/veloxa/meta-ads/`, {
        data: { workspaceId: 'test-workspace', businessId: 'primary', action: 'prepare', planId: 'adcamp_test', adAccountId: '123', connectionId: 'facebook_456', specialAdCategory: 'NONE' },
      });
      assert.equal(prepare.status(), 401);
      const callback = await context.request.post(`${base}/api/veloxa/billing-webhook/`, { form: {} });
      assert.ok([400, 401, 403, 501, 503].includes(callback.status()), `Unexpected callback response ${callback.status()}`);
      assert.equal((await callback.json()).ok, false);
    });
    await check('no unhandled browser exceptions occur', async () => assert.deepEqual(pageErrors, []));
  } finally {
    writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ base, tests: results, pageErrors }, null, 2));
    await browser.close();
  }
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
