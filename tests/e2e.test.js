// End-to-end: real Chromium + the built extension, against fixture pages served
// at https://www.youtube.com via request interception (so content-script
// `matches` apply exactly as on the real site).
//
// Run: npm run build && npm run test:e2e
// First time on a new machine: npx playwright install chromium
//
// What this proves: the plumbing (settings → attrs → CSS/behaviors, popup,
// options, messaging). What it can't prove: that YouTube's live DOM still uses
// these selectors. That's what the popup's match-count badges are for.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
// Lets context.route() see requests made by the extension's service worker
// (SponsorBlock / RYD fetches). Must be set before the browser launches.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = await import('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(root, '.output/chrome-mv3');
const fixture = (name) => readFileSync(join(root, 'tests/fixtures', name), 'utf8');

let ctx, sw, extId, popup, options;

before(async () => {
  ctx = await chromium.launchPersistentContext('', {
    // channel 'chromium' = full browser in new-headless mode; the default
    // headless shell can't load extensions.
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    acceptDownloads: true,
  });
  await ctx.route('https://www.youtube.com/**', (route) => {
    const { pathname } = new URL(route.request().url());
    route.fulfill({ contentType: 'text/html', body: fixture(pathname === '/watch' ? 'watch.html' : 'home.html') });
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('.toggle');
});

after(() => ctx?.close());

// ── helpers ──

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function setToggle(label, on) {
  const row = popup.locator('label.toggle', { hasText: label });
  // Groups are collapsible: open the parent <details> if needed
  const details = popup.locator('details', { has: row });
  if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click();
  const input = row.locator('input');
  if ((await input.isChecked()) !== on) await input.click();
}

async function openGroupOf(row) {
  const details = popup.locator('details', { has: row });
  if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click();
}

async function setSelect(label, value) {
  const row = popup.locator('label.toggle', { hasText: label });
  await openGroupOf(row);
  await row.locator('select').selectOption(value);
}
const setQuality = (value) => setSelect('Default quality', value);

async function setNumber(label, n) {
  const row = popup.locator('label.toggle', { hasText: label });
  await openGroupOf(row);
  await row.locator('input').fill(n ? String(n) : '');
  await row.locator('input').press('Enter'); // commits via blur
}

// Merge feature values straight into storage, for things a headless test can't
// click through (the native host-permission prompt). Data only: the extension
// CSP forbids eval/new Function inside the service worker.
const patchFeatures = (features) =>
  sw.evaluate(async (features) => {
    const { 'bft:settings': s } = await chrome.storage.local.get('bft:settings');
    await chrome.storage.local.set({ 'bft:settings': { ...s, features: { ...s.features, ...features } } });
  }, features);

const readStorage = (key) => sw.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key);

const visible = (page, ids) =>
  page.evaluate(
    (ids) => Object.fromEntries(ids.map((id) => [id, getComputedStyle(document.getElementById(id)).display !== 'none'])),
    ids,
  );

// Send a message to the content script in the first YouTube tab, from the
// extension's own service worker (what the context menu does in real use).
const toContentScript = (msg) =>
  sw.evaluate(async (msg) => {
    for (const tab of await chrome.tabs.query({})) {
      try {
        return await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
      } catch {}
    }
    return null;
  }, msg);

async function openHome() {
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/');
  await settle();
  return page;
}

// ── tests (sequential, share one browser profile) ──

test('defaults hide Shorts and chips, leave normal content', async () => {
  const page = await openHome();
  assert.deepEqual(await visible(page, ['guide-shorts', 'chips', 'shorts-shelf', 't-short-overlay', 't-normal', 't-live']), {
    'guide-shorts': false,
    chips: false,
    'shorts-shelf': false,
    't-short-overlay': false,
    't-normal': true,
    't-live': true, // hide-live is off by default
  });
  await page.close();
});

test('disable hover effects hides new thumbnail actions and card tint, and restores them when off', async () => {
  const page = await openHome();
  await page.evaluate(html => document.body.insertAdjacentHTML('afterbegin', html), fixture('hover.html'));
  const card = page.locator('#hover-card');
  const actions = card.locator('yt-thumbnail-hover-overlay-toggle-actions-view-model');
  const feedback = card.locator('.ytSpecTouchFeedbackShapeHoverEffect');
  try {
    await card.hover();
    assert.equal(await actions.isVisible(), true);
    assert.equal(await feedback.isVisible(), true);
    await setToggle('Disable video hover effects', true);
    await page.waitForSelector('html[data-bft-disable-hover-effects]');
    await card.hover();
    assert.equal(await actions.isVisible(), false);
    assert.equal(await feedback.isVisible(), false);
    assert.equal(await card.locator('a').isVisible(), true);
    assert.equal(await card.locator('yt-thumbnail-badge-view-model').isVisible(), true);
    // YouTube changes this class while entering/leaving the thumbnail.
    await actions.evaluate(el => el.classList.add('ytThumbnailHoverOverlayToggleActionsViewModelHidden'));
    assert.equal(await actions.isVisible(), false);
    await actions.evaluate(el => el.classList.remove('ytThumbnailHoverOverlayToggleActionsViewModelHidden'));
    await setToggle('Disable video hover effects', false);
    await page.waitForSelector('html:not([data-bft-disable-hover-effects])');
    await card.hover();
    assert.equal(await actions.isVisible(), true);
    assert.equal(await feedback.isVisible(), true);
  } finally {
    await patchFeatures({ 'disable-hover-effects': false });
    await page.close();
  }
});

test('diagnostics report per-feature match counts', async () => {
  const page = await openHome();
  const diag = await toContentScript({ type: 'bft:diagnose' });
  assert.ok(diag.counts['hide-shorts'] >= 3, `shorts count ${diag.counts['hide-shorts']}`);
  assert.equal(diag.counts['hide-comments'], 0);
  assert.deepEqual(diag.invalid, [], 'every selector parses in Chromium');
  await page.close();
});

test('sidebar subscriptions can be hidden and restored live without hiding Home', async () => {
  const page = await openHome();
  await page.evaluate(html => document.body.insertAdjacentHTML('afterbegin', html), fixture('guide.html'));
  try {
    await setToggle('Hide Subscriptions section', true);
    await page.waitForSelector('html[data-bft-hide-subscriptions]');
    assert.equal(await page.locator('#subscription-channels').isVisible(), false);
    assert.equal(await page.locator('#classic-subs-row').isVisible(), false);
    assert.equal(await page.locator('#home-row').isVisible(), true);
    assert.equal(await page.locator('#report-row').isVisible(), true);
    const cheap = await toContentScript({ type: 'bft:diagnose', selectors: false });
    assert.deepEqual(cheap.counts, {}, 'normal popup requests no selector scans');
    await setToggle('Hide Subscriptions section', false);
    await page.waitForSelector('html:not([data-bft-hide-subscriptions])');
    assert.equal(await page.locator('#subscription-channels').isVisible(), true);
  } finally {
    await patchFeatures({ 'hide-subscriptions': false });
    await page.close();
  }
});

test('You sidebar popup exposes independent live toggles for every item', async () => {
  const page = await openHome();
  await page.evaluate(html => document.body.insertAdjacentHTML('afterbegin', html), fixture('you-guide.html'));
  const items = [
    ['Hide You heading', 'heading', 'hide-you-heading'],
    ['Hide Your channel', 'channel', 'hide-you-channel'],
    ['Hide History', 'history', 'hide-you-history'],
    ['Hide Playlists', 'playlists', 'hide-you-playlists'],
    ['Hide Watch later', 'watch-later', 'hide-you-watch-later'],
    ['Hide Liked videos', 'liked-videos', 'hide-you-liked-videos'],
    ['Hide Your videos', 'videos', 'hide-you-videos'],
    ['Hide Downloads', 'downloads', 'hide-you-downloads'],
    ['Hide Clips', 'clips', 'hide-you-clips'],
    ['Hide Show less', 'show-less', 'hide-you-show-less'],
  ];
  try {
    for (const [label, row, id] of items) {
      await setToggle(label, true);
      await page.waitForSelector(`html[data-bft-${id}]`);
      assert.equal(await page.locator(`[data-row="${row}"]`).isVisible(), false);
      assert.equal(await page.locator('#other-channel').isVisible(), true);
      await setToggle(label, false);
      await page.waitForSelector(`html:not([data-bft-${id}])`);
      assert.equal(await page.locator(`[data-row="${row}"]`).isVisible(), true);
    }
  } finally {
    await patchFeatures(Object.fromEntries(items.map(([, , id]) => [id, false])));
    await page.close();
  }
});

test('blocklist: options page edits apply live, incl. recycled tiles', async () => {
  const page = await openHome();
  options = await ctx.newPage();
  await options.goto(`chrome-extension://${extId}/options.html`);
  const [kw, ch] = [options.locator('textarea').nth(0), options.locator('textarea').nth(1)];
  await kw.fill('reaction\n/\\bunbox(ing)?\\b/');
  await kw.press('Control+s');
  await ch.fill('@SpamChannel');
  // nth() on sections, not `has: textarea.nth(1)`: `has` is evaluated inside each
  // section, where there's only ever one textarea.
  await options.locator('section.card').nth(1).getByRole('button', { name: 'Save' }).click();
  await settle();
  assert.deepEqual(await visible(page, ['t-normal', 't-keyword', 't-handle', 't-lockup']), {
    't-normal': true,
    't-keyword': false,
    't-handle': false,
    't-lockup': false,
  });
  // Same element, new title → must be re-evaluated
  await page.evaluate(() => window.recycle());
  await settle();
  assert.equal((await visible(page, ['t-normal']))['t-normal'], false, 'recycled tile re-checked');
  await page.close();
});

test('right-click "Block this channel" adds the channel and updates options live', async () => {
  const page = await openHome();
  await page.dispatchEvent('#t-ctx #video-title', 'contextmenu');
  const res = await toContentScript({ type: 'bft:block-channel' });
  assert.deepEqual(res, { ok: true, entry: '@ctxchannel' });
  await settle();
  assert.equal((await visible(page, ['t-ctx']))['t-ctx'], false);
  // Options page was open and untouched → derived draft shows the new entry
  assert.match(await options.locator('textarea').nth(1).inputValue(), /@ctxchannel/);
  await page.close();
});

test('blocklist toggle off unhides instantly', async () => {
  const page = await openHome();
  await setToggle('Apply blocklist', false);
  await settle(200);
  assert.deepEqual(await visible(page, ['t-keyword', 't-handle']), { 't-keyword': true, 't-handle': true });
  await setToggle('Apply blocklist', true);
  await page.close();
});

test('hide watched: 90%+ only', async () => {
  await setToggle('Hide watched', true);
  const page = await openHome();
  assert.deepEqual(await visible(page, ['w95', 'w9', 'w100', 'w50']), { w95: false, w9: true, w100: false, w50: true });
  await page.close();
});

test('Shorts redirect: link click and hard load', async () => {
  const page = await openHome();
  await page.click('#shortlink');
  await page.waitForURL('**/watch?v=CCCCCCCCCCC');
  await page.goto('https://www.youtube.com/shorts/BBBBBBBBBBB');
  await page.waitForURL('**/watch?v=BBBBBBBBBBB');
  await page.close();
});

test('watch page: autonav off, theater on, quality via player API, hashtags hidden', async () => {
  await setToggle('Theater mode', true);
  await setQuality('hd720');
  await settle(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await settle(800);
  assert.equal(await page.getAttribute('.ytp-autonav-toggle-button', 'aria-checked'), 'false');
  assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater')), true);
  assert.deepEqual(await page.evaluate(() => __calls), ['hd720']);
  assert.deepEqual(await visible(page, ['super-title', 'comments']), { 'super-title': false, comments: true });

  // Live re-apply on setting change
  await setQuality('max');
  await settle(300);
  assert.deepEqual(await page.evaluate(() => __calls), ['hd720', 'hd1080']);

  // User exits theater; an unrelated toggle flip must not re-force it
  await page.click('.ytp-size-button');
  await setToggle('Hide live chat', true);
  await settle(300);
  assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater')), false);
  await page.close();
});

test('watch actions: bell, reactions, Save and three-dot menu hidden; Share copies without dialog', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA&list=PL123');
  await page.locator('#share-native.bft-share-button').waitFor();
  assert.equal(await page.locator('#bell').isVisible(), false);
  assert.equal(await page.locator('#bell-modern').isVisible(), false);
  assert.equal(await page.locator('#reactions').isVisible(), false);
  assert.equal(await page.locator('#save-button').isVisible(), false);
  assert.equal(await page.locator('#more-native').isVisible(), false);
  assert.equal(await page.locator('#description').isVisible(), true);
  assert.equal(await page.locator('#share-native').isVisible(), true);
  assert.equal(await page.locator('#share-native .ytSpecButtonShapeNextButtonTextContent').isVisible(), false);
  await page.locator('#share-native').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://youtu.be/AAAAAAAAAAA');
  assert.equal(await page.evaluate(() => window.__shareOpened), false);
  await setToggle('Hide Share button', true);
  assert.equal(await page.locator('#share-button').isVisible(), false);
  await setToggle('Ctrl+C copies video link', true); // its own toggle now, no longer implied by hiding Share
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://youtu.be/AAAAAAAAAAA');
  await page.locator('#bft-link-copied').waitFor();
  assert.equal(await page.locator('#bft-link-copied').textContent(), '✓Link Copied!');
  await setToggle('Hide Share button', false);
  await setToggle('Ctrl+C copies video link', false);
  await setToggle('Hide description', true);
  assert.equal(await page.locator('#description').isVisible(), false);
  await setToggle('Hide description', false);
  await page.close();
});

test('watch sidebar suggestion limit follows the chosen number', async () => {
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  const shown = () => page.locator('#related ytd-compact-video-renderer:visible').count();
  assert.equal(await shown(), 5);
  assert.equal(await page.locator('#related-spinner').isVisible(), true);
  await setNumber('Limit suggested videos', 2);
  await settle(200);
  assert.equal(await shown(), 2);
  assert.equal(await page.locator('#related-spinner').isVisible(), false);
  await setNumber('Limit suggested videos', 4);
  await settle(200);
  assert.equal(await shown(), 4);
  await setNumber('Limit suggested videos', 0);
  await settle(200);
  assert.equal(await shown(), 5);
  assert.equal(await page.locator('#related-spinner').isVisible(), true);
  await page.close();
});

test('watch title and channel row alignment can change independently', async () => {
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await setSelect('Video title alignment', 'center');
  await setSelect('Channel row alignment', 'right');
  assert.equal(await page.locator('#title').evaluate((el) => getComputedStyle(el).textAlign), 'center');
  assert.equal(await page.locator('#owner').evaluate((el) => getComputedStyle(el).justifyContent), 'flex-end');
  await setSelect('Video title alignment', 'right');
  await setSelect('Channel row alignment', 'center');
  assert.equal(await page.locator('#title').evaluate((el) => getComputedStyle(el).textAlign), 'right');
  const centeringError = await page.locator('#owner').evaluate((el) => {
    const owner = el.getBoundingClientRect();
    const row = el.closest('#top-row').getBoundingClientRect();
    return Math.abs((owner.left + owner.right) / 2 - (row.left + row.right) / 2);
  });
  assert.ok(centeringError < 1, `channel row is ${centeringError}px off center`);
  await setSelect('Video title alignment', 'left');
  await setSelect('Channel row alignment', 'left');
  await page.close();
});

test('master switch off shows everything', async () => {
  const page = await openHome();
  await popup.locator('.switch--master').click();
  await settle(200);
  const v = await visible(page, ['chips', 'shorts-shelf', 't-keyword', 'w95']);
  assert.ok(Object.values(v).every(Boolean), JSON.stringify(v));
  await popup.locator('.switch--master').click();
  await page.close();
});

test('export → import round-trip, import is sanitized', async () => {
  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.app, 'betterftube');
  assert.deepEqual(exported.lists.channels, ['@SpamChannel', '@ctxchannel']);

  // Mangle it: unknown keys, bad types, duplicate list entries
  exported.features['hide-comments'] = true;
  exported.features['default-quality'] = 'hd9001';
  exported.features.bogus = true;
  exported.lists.keywords = ['dupe', 'DUPE', '  '];
  options.once('dialog', dialog => dialog.accept());
  await options.locator('input[type=file]').setInputFiles({
    name: 'settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await options.getByText(/^Imported/).waitFor();
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('bft:settings'))['bft:settings']);
  assert.equal(stored.features['hide-comments'], true);
  assert.equal(stored.features['default-quality'], 'off', 'invalid select value → default');
  assert.ok(!('bogus' in stored.features));
  assert.deepEqual(stored.lists.keywords, ['dupe']);
});

// ── v2 ──────────────────────────────────────────────────────────────────

test('localStorage mirror applies attrs before any page script runs', async () => {
  const page = await openHome(); // previous loads already populated the mirror
  await page.reload();
  const early = await page.evaluate(() => window.__earlyAttrs);
  assert.ok(early.includes('data-bft-on'), early.join(','));
  assert.ok(early.includes('data-bft-hide-shorts'));
  await page.close();
});

test('filters: duration, views, age; unparseable tiles kept', async () => {
  await setNumber('Hide shorter than', 2);
  await setNumber('Hide fewer views than', 1000);
  await setNumber('Hide older than', 30);
  const page = await openHome();
  assert.deepEqual(await visible(page, ['f-short', 'f-few', 'f-old', 'f-ok', 't-normal']), {
    'f-short': false,
    'f-few': false,
    'f-old': false,
    'f-ok': true,
    't-normal': true, // no duration/metadata → fail open
  });
  // Turning a filter off unhides live, without reload
  await setNumber('Hide shorter than', 0);
  await settle();
  assert.equal((await visible(page, ['f-short']))['f-short'], true);
  await setNumber('Hide fewer views than', 0);
  await setNumber('Hide older than', 0);
  await page.close();
});

test('allowlist mode hides everything not allowlisted', async () => {
  await options.bringToFront();
  await options.locator('textarea').nth(2).fill('@goodchannel');
  await options.locator('section.card').nth(2).getByRole('button', { name: 'Save' }).click();
  await setToggle('Allowlist mode', true);
  const page = await openHome();
  assert.deepEqual(await visible(page, ['t-normal', 'f-ok']), { 't-normal': true, 'f-ok': false });
  await setToggle('Allowlist mode', false);
  await settle();
  assert.equal((await visible(page, ['f-ok']))['f-ok'], true);
  await page.close();
});

test('Home → Subscriptions: hard load and logo click', async () => {
  await setToggle('Home → Subscriptions', true);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/');
  await page.waitForURL('**/feed/subscriptions');
  await page.goto('https://www.youtube.com/results?search_query=x');
  await settle();
  await page.click('#logo');
  await page.waitForURL('**/feed/subscriptions');
  await setToggle('Home → Subscriptions', false);
  await page.close();
});

test('element picker: hover, click (swallowed), Hide → rule saved and applied', async () => {
  const page = await openHome();
  await toContentScript({ type: 'bft:pick' });
  const box = await page.locator('#promo').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.click(box.x + 5, box.y + 5);
  assert.equal(await page.evaluate(() => window.__promoClicked), undefined, 'page never saw the click');
  // Playwright CSS pierces open shadow roots
  const first = await page.locator('#bft-picker .cands code').first().textContent();
  assert.match(first, /ytd-promo-thing/);
  await page.locator('#bft-picker .save').click();
  await settle();
  assert.equal(await page.locator('#bft-picker').count(), 0, 'picker closed');
  assert.equal((await visible(page, ['promo'])).promo, false);
  const { rules } = (await readStorage('bft:settings')).custom;
  assert.equal(rules.length, 1);
  const diag = await toContentScript({ type: 'bft:diagnose' });
  assert.equal(diag.counts[`rule:${rules[0].id}`], 1);
  // Rule shows in the popup's Custom group and can be toggled off
  await setToggle(rules[0].label, false);
  await settle(200);
  assert.equal((await visible(page, ['promo'])).promo, true);
  await page.close();
});

test('custom CSS applies and respects its toggle', async () => {
  await options.bringToFront();
  await options.locator('textarea').nth(3).fill('#t-normal { outline: 3px solid rgb(1, 2, 3) }');
  await options.locator('textarea').nth(3).press('Control+s');
  const page = await openHome();
  const outline = () => page.evaluate(() => getComputedStyle(document.getElementById('t-normal')).outlineColor);
  assert.equal(await outline(), 'rgb(1, 2, 3)');
  await setToggle('Apply custom CSS', false);
  await settle(200);
  assert.notEqual(await outline(), 'rgb(1, 2, 3)');
  await setToggle('Apply custom CSS', true);
  await page.close();
});

test('default speed via player API; per-channel memory only from user input', async () => {
  await setSelect('Default speed', '1.5');
  await setToggle('Remember speed per channel', true);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await settle(800);
  assert.deepEqual(await page.evaluate(() => __rates), [1.5]);

  // Programmatic change with no user input (= YouTube restoring its own rate) → ignored
  await page.evaluate(() => (document.querySelector('video').playbackRate = 3));
  await settle(300);
  assert.deepEqual((await readStorage('bft:speeds')) ?? {}, {});

  // User-initiated: trusted key event, then the rate change → remembered
  await page.keyboard.press('Shift+Period');
  await page.evaluate(() => (document.querySelector('video').playbackRate = 2));
  await settle(300);
  assert.deepEqual(await readStorage('bft:speeds'), { UCspeedchan: 2 }); // player channel_id, never the owner-row handle

  // Same channel again → channel speed wins over default
  await page.reload();
  await settle(1000);
  assert.equal((await page.evaluate(() => __rates)).at(-1), 2);
  await setToggle('Remember speed per channel', false);
  await setSelect('Default speed', 'off');
  await page.close();
});

test('network features: refused without permission, work with it', async () => {
  let sbHits = 0;
  await ctx.route('https://sponsor.ajay.app/**', (route) => {
    sbHits++;
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([
        { videoID: 'AAAAAAAAAAA', segments: [{ segment: [1, 4], category: 'sponsor', actionType: 'skip', UUID: 'u1' }] },
      ]),
    });
  });
  await ctx.route('https://returnyoutubedislikeapi.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ dislikes: 12345 }),
    }),
  );
  // Enable directly in storage: the native permission prompt can't be clicked headless
  await patchFeatures({ sponsorblock: 'sponsor', dislikes: true, 'hide-like-dislike': false });

  // 1) No grant → background refuses, nothing fetched, nothing shown
  let page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await settle(1000);
  assert.equal(sbHits, 0, 'no request without host permission');
  assert.equal(await page.locator('.bft-dislikes').count(), 0);
  await page.close();

  // 2) Simulate the grant (patch the worker's permission check)
  await sw.evaluate(() => {
    chrome.permissions.contains = async () => true;
  });
  page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await page.locator('.bft-dislikes').waitFor();
  assert.equal(await page.locator('.bft-dislikes').textContent(), '12.3K');
  assert.equal(sbHits, 1);
  // Seek into the sponsor segment → skipped to its end
  await page.evaluate(() => (document.querySelector('video').currentTime = 2));
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 4, null, { timeout: 5000 });
  await patchFeatures({ sponsorblock: 'off', dislikes: false, 'hide-like-dislike': true });
  await page.close();
});

test('presets: built-in chips, active highlight, save current', async () => {
  await popup.bringToFront();
  await popup.getByRole('button', { name: 'Focus', exact: true }).click();
  await settle(200);
  assert.equal(await popup.getByRole('button', { name: 'Focus', exact: true }).getAttribute('aria-pressed'), 'true');
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  await settle();
  assert.equal((await visible(page, ['comments'])).comments, false, 'Focus hides comments');
  await page.close();

  // Diverge from Focus → no chip active → "+ Save" appears
  await setToggle('Hide live streams', true);
  await popup.getByRole('button', { name: '+ Save' }).click();
  await popup.getByPlaceholder('Preset name').fill('Mine');
  await popup.getByPlaceholder('Preset name').press('Enter');
  await settle(200);
  assert.equal(await popup.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed'), 'true');
  assert.equal((await readStorage('bft:settings')).presets[0].name, 'Mine');
  await popup.getByRole('button', { name: 'Default', exact: true }).click();
  await settle(200);
});

test('popup renders every feature, with icon in manifest', async () => {
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  assert.ok(manifest.icons?.['128'], 'icon missing from manifest');
  const { FEATURES } = await import('../lib/features.js');
  // Open all groups and count rows. Re-query each time: opening one changes
  // which elements match `details:not([open])`, so a snapshot goes stale.
  const closed = popup.locator('details:not([open]) summary');
  while ((await closed.count()) > 0) await closed.first().click();
  const rules = (await readStorage('bft:settings')).custom.rules.length;
  assert.equal(await popup.locator('label.toggle').count(), FEATURES.length + rules);
  assert.deepEqual(Object.keys(manifest.commands).sort(), ['cycle-preset', 'pick-element', 'toggle-enabled']);
  assert.deepEqual(manifest.optional_host_permissions.sort(), [
    'https://returnyoutubedislikeapi.com/*',
    'https://sponsor.ajay.app/*',
  ]);
  assert.equal(manifest.host_permissions, undefined, 'no install-time host permissions');
});
