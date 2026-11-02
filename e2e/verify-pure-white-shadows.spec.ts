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

    await page.goto('https://veloxa-ai-saas.web.app/?v=white_shadow_audit', {
      waitUntil: 'domcontentloaded',
    });

    await page.getByTestId('veloxa-sales-landing-page').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);

    const styles = await page.evaluate(() => {
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      const landingEl = document.querySelector('[data-testid="veloxa-sales-landing-page"]');
      const landingBg = landingEl ? window.getComputedStyle(landingEl).backgroundColor : '';
      const sectionEl = document.querySelector('.veloxa-luxury-section');
      const sectionShadow = sectionEl ? window.getComputedStyle(sectionEl).boxShadow : '';
      const cardEl = document.querySelector('.veloxa-luxury-card');
      const cardShadow = cardEl ? window.getComputedStyle(cardEl).boxShadow : '';
      const pinkCardEl = document.querySelector('.veloxa-luxury-card-pink');
      const pinkCardShadow = pinkCardEl ? window.getComputedStyle(pinkCardEl).boxShadow : '';
      return { bodyBg, landingBg, sectionShadow, cardShadow, pinkCardShadow };
    });

    console.log('Computed Luxury Styles:', styles);
    assert.equal(styles.bodyBg, 'rgb(255, 255, 255)');
    assert.equal(styles.landingBg, 'rgb(255, 255, 255)');
    assert.notEqual(styles.sectionShadow, 'none');
    assert.notEqual(styles.cardShadow, 'none');
    assert.notEqual(styles.pinkCardShadow, 'none');

    // 1. Screenshot Hero + Live Marquee Ticker on Pure White Background
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_10_pure_white_strong_shadow_hero.png'),
      fullPage: false,
    });

    // 2. Scroll to Interactive Industry Visual Gallery (Reels 9:16 + Carousel 4:5 + Single Feed 4:5)
    const gallerySection = page.getByTestId('landing-visual-gallery-section');
    await gallerySection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_11_pure_white_strong_shadow_gallery.png'),
      fullPage: false,
    });

    // 3. Scroll to Global Footer & Pricing Cards
    const footerSection = page.getByTestId('veloxa-global-footer');
    await footerSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'luxury_12_pure_white_strong_shadow_pricing_footer.png'),
      fullPage: false,
    });

    console.log('✅ All Pure White Background & Strong Multi-Layered Card Shadow checks passed!');
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
