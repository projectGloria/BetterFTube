// Real rendering engines, using the feedback rules from YouTube's stylesheet.
// Run: node --test tests/hover.test.js (requires Playwright Chromium and Firefox).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, firefox } from 'playwright';
import { buildStylesheet } from '../lib/features.js';

for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: separate thumbnail feedback layer is hidden and restored`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(readFileSync(new URL('./fixtures/hover.html', import.meta.url), 'utf8'));
      await page.addStyleTag({ content: buildStylesheet() });
      await page.locator('#hover-card').hover();
      const state = () => page.evaluate(() => {
        const css = selector => getComputedStyle(document.querySelector(selector));
        return {
          highlight: css('#hover-card .ytSpecTouchFeedbackShapeHoverEffect').display,
          pseudo: getComputedStyle(document.querySelector('.ytCardViewModelHoverEffect'), '::after').display,
          actions: css('#hover-card yt-thumbnail-hover-overlay-toggle-actions-view-model').display,
          standalone: css('#standalone-thumbnail yt-thumbnail-hover-overlay-toggle-actions-view-model').display,
          unrelated: css('#unrelated-feedback .ytSpecTouchFeedbackShapeHoverEffect').display,
        };
      });
      const original = await state();
      for (const key of ['highlight', 'pseudo', 'actions', 'standalone']) assert.notEqual(original[key], 'none', key);
      await page.evaluate(() => document.documentElement.setAttribute('data-bft-disable-hover-effects', ''));
      const disabled = await state();
      for (const key of ['highlight', 'pseudo', 'actions', 'standalone']) assert.equal(disabled[key], 'none', key);
      assert.equal(disabled.unrelated, original.unrelated);
      assert.equal(await page.locator('#hover-card a').isVisible(), true);
      assert.equal(await page.locator('yt-thumbnail-badge-view-model').isVisible(), true);
      await page.evaluate(() => document.documentElement.removeAttribute('data-bft-disable-hover-effects'));
      assert.deepEqual(await state(), original);
    } finally {
      await browser.close();
    }
  });
}
