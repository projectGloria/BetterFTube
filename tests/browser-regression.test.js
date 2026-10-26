import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, firefox } from 'playwright';
import { FEATURES, buildStylesheet, buildCustomStylesheet } from '../lib/features.js';

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

for (const [name, engine] of Object.entries({ chromium, firefox })) {
  test(`${name}: each You sidebar item toggles independently and restores`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture('you-guide.html'));
      await page.addStyleTag({ content: buildStylesheet() });
      // This default feature must not mistake Your videos for the More from YouTube section.
      await page.evaluate(() => document.documentElement.setAttribute('data-bft-hide-more-from-yt', ''));
      const rows = ['heading', 'channel', 'history', 'playlists', 'watch-later', 'liked-videos', 'videos', 'downloads', 'clips', 'show-less'];
      const features = FEATURES.filter(f => f.group === 'you');
      assert.equal(features.length, rows.length);
      for (const row of rows) assert.equal(await page.locator(`[data-row="${row}"]`).isVisible(), true, row);
      for (let i = 0; i < features.length; i++) {
        const attr = `data-bft-${features[i].id}`;
        await page.evaluate(attr => document.documentElement.setAttribute(attr, ''), attr);
        for (let j = 0; j < rows.length; j++)
          assert.equal(await page.locator(`[data-row="${rows[j]}"]`).isVisible(), i !== j, `${features[i].id} / ${rows[j]}`);
        assert.equal(await page.locator('#other-channel').isVisible(), true);
        assert.equal(await page.locator('#other-playlist').isVisible(), true);
        assert.equal(await page.locator('#content-history').isVisible(), true);
        await page.evaluate(attr => document.documentElement.removeAttribute(attr), attr);
        assert.equal(await page.locator(`[data-row="${rows[i]}"]`).isVisible(), true);
      }
      // A saved Show less preference must not remove the route to expand the list.
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-bft-hide-you-show-less', '');
        document.querySelector('ytd-guide-collapsible-entry-renderer').removeAttribute('expanded');
      });
      assert.equal(await page.locator('[data-row="show-more"]').isVisible(), true);
    } finally { await browser.close(); }
  });

  test(`${name}: subscriptions toggle hides only subscriptions; picker isolates Report history`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture('guide.html'));
      await page.addStyleTag({ content: buildStylesheet() });
      await page.evaluate(() => document.documentElement.setAttribute('data-bft-hide-subscriptions', ''));
      assert.equal(await page.locator('#subscription-channels').isVisible(), false);
      assert.equal(await page.locator('#modern-subscriptions').isVisible(), false);
      assert.equal(await page.locator('#classic-subs-row').isVisible(), false);
      assert.equal(await page.locator('#home-row').isVisible(), true);
      assert.equal(await page.locator('#report-row').isVisible(), true);
      await page.evaluate(() => document.documentElement.removeAttribute('data-bft-hide-subscriptions'));
      assert.equal(await page.locator('#subscription-channels').isVisible(), true);
      assert.equal(await page.locator('#modern-subscriptions').isVisible(), true);
      await page.addScriptTag({ content: source('lib/picker.js') });
      await page.evaluate(() => startPicker({ onSave: rule => { window.savedRule = rule; } }));
      await page.locator('#report-row tp-yt-paper-item').click();
      const first = page.locator('#bft-picker label.c').first();
      assert.match(await first.innerText(), /1 match/);
      assert.match(await first.innerText(), /reporthistory/);
      await page.locator('#bft-picker button.save').click();
      const saved = await page.evaluate(() => savedRule);
      assert.deepEqual(await page.locator(saved.selector).evaluateAll(els => els.map(el => el.id)), ['report-row']);
      await page.evaluate(() => document.documentElement.setAttribute('data-bft-on', ''));
      await page.addStyleTag({ content: buildCustomStylesheet({ rules: [{ ...saved, enabled: true }], css: '' }, { cssEnabled: false }) });
      assert.equal(await page.locator('#report-row').isVisible(), false);
      assert.equal(await page.locator('#help-row').isVisible(), true);
      assert.equal(await page.locator('#home-row').isVisible(), true);
    } finally { await browser.close(); }
  });

  test(`${name}: player/comment mutation bursts do not rescan watch controls or unlimited suggestions`, async () => {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<ytd-watch-flexy>
        <div id="movie_player"></div><ytd-watch-metadata><div id="owner"></div><div id="actions"></div></ytd-watch-metadata>
        <ytd-comments></ytd-comments><div id="related"><yt-lockup-view-model>Video</yt-lockup-view-model></div>
      </ytd-watch-flexy>`);
      await page.addScriptTag({ content: `const attrFor = id => 'data-bft-' + id;\n${source('lib/dom.js')}\n${source('lib/watch-controls.js')}\n${source('lib/suggestions.js')}` });
      await page.evaluate(async () => {
        document.documentElement.setAttribute('data-bft-on', '');
        document.documentElement.setAttribute('data-bft-hide-save-button', '');
        window.work = { controls: 0, suggestions: 0 };
        const mark = markWatchControls, limit = limitSuggestions;
        markWatchControls = (...args) => { work.controls++; return mark(...args); };
        limitSuggestions = (...args) => { work.suggestions++; return limit(...args); };
        window.controller = new AbortController();
        await startWatchControls(controller.signal);
        await startSuggestionLimit(controller.signal);
      });
      await page.waitForTimeout(150);
      await page.evaluate(() => { work.controls = 0; work.suggestions = 0; });
      for (let batch = 0; batch < 10; batch++) {
        await page.evaluate(() => {
          for (const root of document.querySelectorAll('#movie_player, ytd-comments, #related'))
            for (let i = 0; i < 100; i++) root.append(document.createElement('span'));
        });
        await page.waitForTimeout(15);
      }
      await page.waitForTimeout(150);
      assert.deepEqual(await page.evaluate(() => work), { controls: 0, suggestions: 0 });
      // A real action-row change still gets marked and hidden by its setting.
      await page.evaluate(() => {
        document.querySelector('#actions').innerHTML = '<yt-button-view-model><button aria-label="Save">Save</button></yt-button-view-model>';
      });
      await page.waitForSelector('.bft-save-button');
      assert.equal((await page.evaluate(() => work.controls)), 1);
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-bft-on');
      });
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        work.controls = 0;
        document.querySelector('#actions').append(document.createElement('button'));
      });
      await page.waitForTimeout(150);
      assert.equal((await page.evaluate(() => work.controls)), 0);
      await page.evaluate(() => controller.abort());
    } finally { await browser.close(); }
  });
}
