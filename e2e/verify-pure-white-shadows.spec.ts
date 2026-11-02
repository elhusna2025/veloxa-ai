import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';

const ARTIFACT_DIR =
  '/Users/macbookpro2019/.gemini/antigravity/brain/641691da-b757-49db-abb3-5e6c47e13379';

async function runVerification() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();

    await page.goto('https://veloxa-ai-saas.web.app/?v=dynamic_hero_audit', {
      waitUntil: 'domcontentloaded',
    });

    await page.getByTestId('veloxa-sales-landing-page').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);

    // Verify redundant second language bar in Hero is gone
    const redundantLangBtnCount = await page.locator('[data-testid^="landing-lang-btn-"]').count();
    assert.equal(redundantLangBtnCount, 0);

    // Verify Slide 1 (Promo & 4 Sosmed) is visible initially
    await page.getByTestId('hero-dynamic-tab-promo_pricing').click();
    await page.waitForTimeout(400);
    const slide1Text = await page.getByTestId('hero-dynamic-headline-box').textContent();
    assert.ok(slide1Text?.includes('Rp500.000/Bulan'));

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_13_clean_header_dynamic_hero_slide1.png'),
      fullPage: false,
    });

    // Click Slide 2 (Tiru Gaya + Foto Asli) and verify dynamic headline morphs
    await page.getByTestId('hero-dynamic-tab-dual_brand_vault').click();
    await page.waitForTimeout(450);
    const slide2Text = await page.getByTestId('hero-dynamic-headline-box').textContent();
    assert.ok(slide2Text?.includes('Foto Produk Asli Anda'));

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_14_clean_header_dynamic_hero_slide2.png'),
      fullPage: false,
    });

    // Click Slide 3 (AI Meta Ads ROAS 6.8x) and verify dynamic headline morphs
    await page.getByTestId('hero-dynamic-tab-ai_meta_ads').click();
    await page.waitForTimeout(450);
    const slide3Text = await page.getByTestId('hero-dynamic-headline-box').textContent();
    assert.ok(slide3Text?.includes('Scale-Up ROAS 6.8x'));

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_15_clean_header_dynamic_hero_slide3.png'),
      fullPage: false,
    });

    console.log('✅ Clean Header & Dynamic Rotating Hero Headline + Promo checks passed!');
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
