import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { normalize, DEFAULTS } from '../lib/settings.js';
import { isSafeSelector, validateBackup, LIMITS } from '../lib/validation.js';
import { applyChanges, settingsChanges, serialQueue } from '../lib/mutations.js';
import { buildCustomStylesheet, attrFor, FEATURES, TILES } from '../lib/features.js';
import { compileMatcher, invalidRegexLines } from '../lib/blocklist.js';
import { compileFilters } from '../lib/filters.js';
import { parseSegments, fetchDislikes, isVideoId } from '../lib/api.js';
import { normalizeSpeeds } from '../lib/speeds.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = file => readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
function environment(t, html = '') {
  const dom = new JSDOM(`<html><body>${html}</body></html>`, { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const ctx = dom.getInternalVMContext();
  Object.assign(ctx, { attrFor, TILES, compileMatcher, compileFilters,
    loadSpeeds: async () => ({}), onSpeedsChanged: () => {}, saveSpeed: async () => {},
    startWatchControls: () => {}, startSuggestionLimit: () => {}, startWatchScrollbar: () => {},
    interceptShareClick: () => {}, interceptCopyShortcut: () => {} });
  vm.runInContext(source('lib/dom.js'), ctx);
  return { dom, ctx, run: code => vm.runInContext(code, ctx) };
}

test('watch controls mark actions and Share copies the clean video link', async (t) => {
  const { ctx, run } = environment(t, `<ytd-watch-flexy><ytd-watch-metadata>
    <yt-button-view-model id="share-button"><button aria-label="Share"><yt-icon icon-type="SHARE"></yt-icon>Share</button></yt-button-view-model>
    <yt-button-view-model id="save-button"><button aria-label="Save">Save</button></yt-button-view-model>
    <div id="owner"><yt-button-view-model><button aria-label="Current setting: Personalized. Change notification settings">Bell</button></yt-button-view-model></div>
    <div id="actions"><yt-button-view-model><button aria-label="More actions">•••</button></yt-button-view-model></div>
    <div id="description">Details</div>
  </ytd-watch-metadata></ytd-watch-flexy>`);
  const copied = [];
  ctx.navigator.clipboard = { writeText: async (value) => copied.push(value) };
  run(source('lib/watch-controls.js'));
  run('markWatchControls(document.querySelector("ytd-watch-flexy"))');
  assert.equal(run('document.querySelector("#share-button button").classList.contains("bft-share-button")'), true);
  assert.equal(run('document.querySelector("#share-button").classList.contains("bft-share-control")'), true);
  assert.equal(run('document.querySelector("#save-button").classList.contains("bft-save-button")'), true);
  assert.equal(run('document.querySelector("#owner yt-button-view-model").classList.contains("bft-notification-bell")'), true);
  assert.equal(run('document.querySelector("#actions yt-button-view-model").classList.contains("bft-more-actions")'), true);
  for (const [feature, selector] of [
    ['hide-notification-bell', '#owner button'],
    ['hide-more-actions', '#actions button'],
    ['hide-save-button', '#save-button button'],
    ['hide-share-button', '#share-button button'],
    ['hide-description', '#description'],
  ]) {
    const target = ctx.document.querySelector(selector);
    assert.ok(FEATURES.find((f) => f.id === feature).hide.some((rule) => target.closest(rule)), `${feature} must hide its marked control`);
  }
  run('document.documentElement.setAttribute("data-bft-minimal-share", "")');
  const event = {
    target: ctx.document.querySelector('#share-button button'),
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  ctx.shareEvent = event;
  run('interceptShareClick(shareEvent, () => {})');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(copied, ['https://youtu.be/AAAAAAAAAAA']);
  assert.equal(run('shortWatchUrl("https://www.youtube.com/watch?v=BBBBBBBBBBB&list=PL123")'), 'https://youtu.be/BBBBBBBBBBB');
  run('document.documentElement.setAttribute("data-bft-hide-share-button", "")');
  const shortcut = {
    key: 'c', ctrlKey: true, metaKey: false, altKey: false, target: ctx.document.body,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  ctx.shortcut = shortcut;
  let notices = 0;
  ctx.copiedNotice = () => notices++;
  run('interceptCopyShortcut(shortcut, () => {}, copiedNotice)');
  await sleep(0);
  assert.equal(shortcut.prevented, true);
  assert.deepEqual(copied, ['https://youtu.be/AAAAAAAAAAA', 'https://youtu.be/AAAAAAAAAAA']);
  assert.equal(notices, 1, 'confirmation appears after successful copy');
  shortcut.target = ctx.document.createElement('input');
  run('interceptCopyShortcut(shortcut, () => {})');
  assert.equal(copied.length, 2, 'copying in a text field stays native');
});

test('suggestion limit caps sidebar tiles and responds to larger or disabled limits', (t) => {
  const { ctx, run } = environment(t, `<ytd-watch-flexy><div id="related">
    <ytd-compact-video-renderer id="r1"></ytd-compact-video-renderer>
    <ytd-compact-video-renderer id="r2"></ytd-compact-video-renderer>
    <ytd-compact-video-renderer id="r3"></ytd-compact-video-renderer>
    <yt-lockup-view-model id="r4"></yt-lockup-view-model>
  </div></ytd-watch-flexy>`);
  run(source('lib/suggestions.js'));
  const marked = () => [...ctx.document.querySelectorAll('[data-bft-suggestion-overflow]')].map((el) => el.id);
  run('limitSuggestions(document.querySelector("#related"), 2, () => true)');
  assert.deepEqual(marked(), ['r3', 'r4']);
  run('limitSuggestions(document.querySelector("#related"), 3, () => true)');
  assert.deepEqual(marked(), ['r4']);
  run('limitSuggestions(document.querySelector("#related"), 0, () => true)');
  assert.deepEqual(marked(), []);
});

test('watch scrollbar hides for negligible overflow and returns for real content', (t) => {
  const { ctx, run } = environment(t, '<ytd-watch-flexy></ytd-watch-flexy>');
  ctx.document.documentElement.setAttribute('data-bft-on', '');
  ctx.innerHeight = 800;
  Object.defineProperty(ctx.document.body, 'scrollHeight', { configurable: true, value: 800 });
  Object.defineProperty(ctx.document.documentElement, 'scrollHeight', { configurable: true, value: 818 });
  run(source('lib/scrollbar.js'));
  run('updateWatchScrollbar()');
  assert.equal(ctx.document.documentElement.hasAttribute('data-bft-no-scroll'), true);
  Object.defineProperty(ctx.document.documentElement, 'scrollHeight', { configurable: true, value: 900 });
  run('updateWatchScrollbar()');
  assert.equal(ctx.document.documentElement.hasAttribute('data-bft-no-scroll'), false);
});

test('watch CSS reaches the subscribed bell and overflow control by their watch-page IDs', (t) => {
  const { ctx } = environment(t, `<ytd-watch-flexy>
    <div id="notification-preference-button"><button id="bell">Bell</button></div>
    <div id="top-row"><ytd-menu-renderer><yt-button-shape id="button-shape"><button id="more">More</button></yt-button-shape></ytd-menu-renderer></div>
  </ytd-watch-flexy>`);
  for (const [feature, selector] of [
    ['hide-notification-bell', '#bell'],
    ['hide-more-actions', '#more'],
  ]) {
    const target = ctx.document.querySelector(selector);
    assert.ok(FEATURES.find((f) => f.id === feature).hide.some((rule) => target.closest(rule)), `${feature} must reach ${selector}`);
  }
});

test('selector imports cannot close their gate or retain raw parser nodes', () => {
  for (const selector of ['div), body, :is(div', 'a{color:red}', ':unknown(x)', 'a/*x*/', '[x="unterminated]', 'a\\']) {
    assert.equal(isSafeSelector(selector), false, selector);
    assert.equal(normalize({ custom: { rules: [{ selector }] } }).custom.rules.length, 0);
  }
  for (const selector of ['a, b', ':is(a, b)', 'ytd-rich-item-renderer:has(a[href^="/shorts/"])', '[title="(hello)"]']) {
    assert.equal(isSafeSelector(selector), true, selector);
  }
  const custom = { rules: [{ selector: 'div), body, :is(div', enabled: true }], css: '' };
  assert.equal(buildCustomStylesheet(custom, { cssEnabled: false }), '');
  assert.equal(buildCustomStylesheet({ rules: [{ selector: 'body', enabled: true }], css: 'body{}' }, { enabled: false, cssEnabled: true }), '');
});

test('imports reject unrelated objects and normalization bounds data and deduplicates preset IDs', () => {
  for (const input of [{}, [], null, { app: 'other', schema: 1, features: {} }, { app: 'betterftube', schema: 2, features: {} }]) assert.throws(() => validateBackup(input));
  validateBackup({ app: 'betterftube', schema: 1, features: {} });
  const s = normalize({ lists: { keywords: ['x'.repeat(9999)] }, presets: [{ id: 'user:x', name: 'a' }, { id: 'user:x', name: 'b' }] });
  assert.equal(s.lists.keywords[0].length, LIMITS.entry);
  assert.notEqual(s.presets[0].id, s.presets[1].id);
});

test('concurrent changes preserve separate fields, channel additions and rule edits', () => {
  const base = normalize({ custom: { rules: [{ id: 'r', label: 'old', selector: 'a' }] } });
  const first = structuredClone(base), second = structuredClone(base);
  first.lists.channels.push('@one'); first.features['hide-comments'] = true; first.custom.rules[0].label = 'new';
  second.lists.channels.push('@two'); second.features['hide-related'] = true; second.custom.rules[0].enabled = false;
  const result = applyChanges(applyChanges(base, settingsChanges(base, first)), settingsChanges(base, second));
  assert.deepEqual(result.lists.channels, ['@one', '@two']);
  assert.equal(result.features['hide-comments'], true);
  assert.equal(result.features['hide-related'], true);
  assert.equal(result.custom.rules[0].label, 'new');
  assert.equal(result.custom.rules[0].enabled, false);
  assert.throws(() => applyChanges(base, [{ path: ['__proto__', 'polluted'], value: true }]));
});

test('writer queue serializes work and recovers after persistence failure', async () => {
  const enqueue = serialQueue(), order = [];
  const failed = enqueue(async () => { await sleep(10); order.push(1); throw Error('quota'); });
  const second = enqueue(async () => { order.push(2); return 'saved'; });
  await assert.rejects(failed, /quota/);
  assert.equal(await second, 'saved'); assert.deepEqual(order, [1, 2]);
});

test('regex matching is bounded and reports unsupported syntax', { timeout: 3000 }, () => {
  const match = compileMatcher({ keywords: ['/^(a+)+$/'] });
  assert.equal(match({ title: 'a'.repeat(1999) + '!' }), false);
  assert.ok(invalidRegexLines(['/([a])\\1/']).length);
  assert.equal(compileMatcher({ channels: ['UCstable'] })({ channelId: 'UCstable' }), true);
});

test('allowlist fallback is explicit and supports stable channel IDs', () => {
  assert.equal(compileFilters({ allow: [] }), null);
  const match = compileFilters({ allow: ['UCstable'] });
  assert.equal(match({}), false); assert.equal(match({ channelId: 'UCstable' }), false);
  assert.equal(match({ channelId: 'UCother' }), true);
});

test('API payload validation rejects malformed segments and invalid speed records', () => {
  const segment = { actionType: 'skip', category: 'sponsor', UUID: 'valid', segment: [1, 3] };
  const all = [{ videoID: 'v', segments: [null, {}, segment, { ...segment, segment: [1, Infinity] },
    { ...segment, segment: [-1, 2] }, { ...segment, segment: [1, '3'] }, { ...segment, UUID: null },
    { ...segment, category: 'intro' }] }];
  assert.equal(parseSegments(all, 'v', ['sponsor']).length, 1);
  assert.deepEqual(parseSegments([{ videoID: 'v', segments: {} }], 'v'), []);
  assert.deepEqual(normalizeSpeeds({ good: 2, bad: -1, infinite: Infinity, string: '2' }), { good: 2 });
});

test('API deduplicates in-flight requests and supplies an abort signal', async () => {
  let calls = 0;
  const fake = async (_url, options) => {
    calls++; assert.ok(options.signal instanceof AbortSignal); assert.equal(options.credentials, 'omit');
    await sleep(10); return { ok: true, json: async () => ({ dislikes: 4 }) };
  };
  assert.deepEqual(await Promise.all([fetchDislikes('dedup-test1', fake), fetchDislikes('dedup-test1', fake)]), [4, 4]);
  assert.equal(calls, 1);
  await assert.rejects(fetchDislikes('negative123', async () => ({ ok: true, json: async () => ({ dislikes: -1 }) })), /bad payload/);
});

test('waitFor respects already-aborted and later-aborted signals', async t => {
  const { ctx, run } = environment(t, '<button></button>');
  ctx.controller = new AbortController(); ctx.controller.abort();
  assert.equal(await run('waitFor("button", { signal: controller.signal })'), null);
  ctx.controller = new AbortController();
  const waiting = run('waitFor(".missing", { signal: controller.signal })');
  ctx.controller.abort(); assert.equal(await waiting, null);
});

test('SponsorBlock ignores disabled and superseded responses, and page attributes cannot enable requests', async t => {
  const { ctx, run } = environment(t, '<div id="movie_player"><video></video></div>');
  const requests = [];
  ctx.browser = { runtime: { sendMessage: msg => new Promise(resolve => requests.push({ msg, resolve })) } };
  run(source('lib/online.js'));
  run('globalThis.refresh = startOnline({ onSkip() {} })');
  ctx.next = normalize({ features: { sponsorblock: 'sponsor' } }); run('refresh(next)');
  assert.equal(requests.length, 1);
  ctx.next = normalize({ features: { sponsorblock: 'off' } }); run('refresh(next)');
  requests[0].resolve({ ok: true, segments: [{ start: 1, end: 4, uuid: 'one' }] }); await sleep(0);
  run('document.querySelector("video").currentTime = 2; onTimeUpdate({ target: document.querySelector("video") })');
  assert.equal(run('document.querySelector("video").currentTime'), 2);
  run('document.documentElement.setAttribute("data-bft-sponsorblock", "sponsor")'); await sleep(0);
  assert.equal(requests.length, 1);
  ctx.next = normalize({ features: { sponsorblock: 'sponsor' } }); run('refresh(next)');
  ctx.next = normalize({ features: { sponsorblock: 'sponsor,selfpromo,interaction' } }); run('refresh(next)');
  requests[2].resolve({ ok: true, segments: [] }); requests[1].resolve({ ok: true, segments: [{ start: 1, end: 4, uuid: 'old' }] }); await sleep(0);
  run('onTimeUpdate({ target: document.querySelector("video") })');
  assert.equal(run('document.querySelector("video").currentTime'), 2);
});

test('permission refresh retries the current video and revocation clears results', async t => {
  const { ctx, run } = environment(t, '<div id="movie_player"><video></video></div>');
  let granted = false, calls = 0;
  ctx.browser = { runtime: { sendMessage: async () => { calls++; return granted ? { ok: true, segments: [{ start: 1, end: 4, uuid: 'x' }] } : { ok: false, error: 'Permission needed' }; } } };
  run(source('lib/online.js')); run('globalThis.refresh = startOnline({ onSkip() {} })');
  ctx.next = normalize({ features: { sponsorblock: 'sponsor' } }); run('refresh(next)'); await sleep(0);
  assert.equal(run('onlineStatus().sponsorblock'), 'Permission needed');
  granted = true; run('refresh(undefined, true)'); await sleep(0);
  assert.equal(run('onlineStatus().sponsorblock'), 'Ready');
  granted = false; run('refresh(undefined, true)'); await sleep(0);
  run('document.querySelector("video").currentTime = 2; onTimeUpdate({ target: document.querySelector("video") })');
  assert.equal(run('document.querySelector("video").currentTime'), 2); assert.equal(calls, 3);
});

test('background refuses disabled requests and derives categories from saved settings', async () => {
  let listener, settings = normalize({ enabled: false }), fetches = 0, categories;
  const event = { addListener() {} };
  const ctx = vm.createContext({ serialQueue, normalize, applyChanges, isVideoId, normalizeSpeeds,
    defineBackground: fn => fn(), loadSettings: async () => settings, saveSettings: async s => { settings = s; },
    ORIGINS: { sponsorblock: 'https://sponsor.ajay.app/*', dislikes: 'https://returnyoutubedislikeapi.com/*' },
    fetchDislikes: async () => { fetches++; return 1; }, fetchSegments: async (_id, cats) => { fetches++; categories = cats; return []; },
    browser: { runtime: { id: 'test', getURL: () => 'chrome-extension://test/', onInstalled: event, onMessage: { addListener(fn) { listener = fn; } } },
      permissions: { contains: async () => true, onAdded: event, onRemoved: event }, contextMenus: { onClicked: event }, commands: { onCommand: event } },
  });
  vm.runInContext(source('entrypoints/background.js'), ctx);
  const send = msg => new Promise(resolve => listener(msg, { id: 'test', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' }, resolve));
  assert.equal((await send({ type: 'bft:dislikes', videoId: 'AAAAAAAAAAA' })).ok, false); assert.equal(fetches, 0);
  settings = normalize({ features: { sponsorblock: 'sponsor' } });
  assert.equal((await send({ type: 'bft:sb-segments', videoId: 'AAAAAAAAAAA', categories: ['intro'] })).ok, true);
  assert.deepEqual(Array.from(categories), ['sponsor']);
});

test('theater does not wait for an already-off autoplay switch; disabled waits never click', async t => {
  const { ctx, run } = environment(t, '<ytd-watch-flexy><button class="ytp-size-button"></button><button><div class="ytp-autonav-toggle-button" aria-checked="false"></div></button></ytd-watch-flexy>');
  run(source('lib/behaviors.js'));
  run('document.documentElement.setAttribute("data-bft-theater-default", ""); document.documentElement.setAttribute("data-bft-disable-autonav", "")');
  let clicks = 0; ctx.document.querySelector('.ytp-size-button').onclick = () => clicks++;
  run('globalThis.signal = new AbortController().signal');
  await run('Promise.all([enforceAutoplay(signal), enforceTheater(signal)])');
  assert.equal(clicks, 1);
  ctx.document.querySelector('.ytp-size-button').remove();
  const pending = run('enforceTheater(signal)');
  run('document.documentElement.removeAttribute("data-bft-theater-default")');
  const button = ctx.document.createElement('button'); button.className = 'ytp-size-button'; button.onclick = () => clicks++;
  ctx.document.body.append(button); await pending; assert.equal(clicks, 1);
});

test('Home redirect preserves modified clicks', t => {
  const { ctx, run } = environment(t, '<a href="/" id="logo">Home</a><a href="/feed/subscriptions" id="subs">Subs</a>');
  run(source('lib/behaviors.js')); run('document.documentElement.setAttribute("data-bft-home-to-subs", "")');
  let clicks = 0; ctx.document.querySelector('#subs').onclick = e => { clicks++; e.preventDefault(); };
  ctx.target = ctx.document.querySelector('#logo');
  run('interceptHomeClicks({ target, button: 0, ctrlKey: true, preventDefault() { throw Error("intercepted"); } })');
  assert.equal(clicks, 0);
  run('interceptHomeClicks({ target, button: 0, preventDefault() {}, stopImmediatePropagation() {} })'); assert.equal(clicks, 1);
});

test('tile scanner notices text/attribute recycling and stops while disabled', async t => {
  const { ctx, run } = environment(t, '<ytd-rich-item-renderer id="tile"><a id="video-title">normal</a><a href="/@good">channel</a></ytd-rich-item-renderer><div id="unrelated"></div>');
  run(source('lib/behaviors.js'));
  run('document.documentElement.setAttribute("data-bft-on", ""); document.documentElement.setAttribute("data-bft-blocklist", ""); setLists({keywords:["reaction"], channels:["@bad"], allow:[]})');
  await sleep(130);
  const tile = ctx.document.querySelector('#tile'), title = tile.querySelector('#video-title');
  title.firstChild.data = 'reaction'; await sleep(130); assert.equal(tile.hasAttribute('data-bft-blocked'), true);
  title.firstChild.data = 'normal'; await sleep(130); assert.equal(tile.hasAttribute('data-bft-blocked'), false);
  tile.querySelector('a[href]').setAttribute('href', '/@bad'); await sleep(130); assert.equal(tile.hasAttribute('data-bft-blocked'), true);
  let reads = 0; const query = tile.querySelector.bind(tile); tile.querySelector = (...args) => { reads++; return query(...args); };
  ctx.document.querySelector('#unrelated').textContent = 'unrelated'; await sleep(130); assert.equal(reads, 0);
  run('document.documentElement.removeAttribute("data-bft-on"); rebuild()');
  title.firstChild.data = 'reaction'; await sleep(130); assert.equal(reads, 0); assert.equal(tile.hasAttribute('data-bft-blocked'), false);
});

test('enabling speed memory mid-video discovers channel; preview and extension rate changes are ignored', async t => {
  const { ctx, run } = environment(t, '<div id="movie_player"><video id="main"></video></div><video id="preview"></video><ytd-video-owner-renderer><a href="/@channel">owner</a></ytd-video-owner-renderer>');
  const saves = []; ctx.saveSpeed = async (...args) => saves.push(args);
  run(source('lib/behaviors.js'));
  run('document.documentElement.setAttribute("data-bft-video-id", "AAAAAAAAAAA")');
  await run('startSpeedMemory()');
  run('document.documentElement.setAttribute("data-bft-remember-speed", "")'); await sleep(0);
  assert.equal(run('currentChannel'), '@channel');
  run('lastInputAt = performance.now(); document.querySelector("#preview").playbackRate = 2; onRateChange({ target: document.querySelector("#preview") })');
  assert.equal(saves.length, 0);
  run('lastInputAt = performance.now(); document.querySelector("#main").playbackRate = 2; onRateChange({ target: document.querySelector("#main") })');
  assert.equal(saves.length, 1);
});

test('MAIN player bridge clears the recording gesture before changing speed', async t => {
  const { ctx, run } = environment(t, '<div id="movie_player"><video></video></div><ytd-video-owner-renderer><a href="/@channel">owner</a></ytd-video-owner-renderer>');
  let saved = 0;
  ctx.saveSpeed = async () => { saved++; };
  run(source('lib/behaviors.js')); run('startBehaviors()');
  await sleep(0);
  const player = ctx.document.querySelector('#movie_player');
  player.getVideoData = () => ({ video_id: 'AAAAAAAAAAA', channel_id: 'UCfirst' });
  player.setPlaybackRate = rate => {
    const video = player.querySelector('video'); video.playbackRate = rate;
    video.dispatchEvent(new ctx.Event('ratechange'));
  };
  ctx.defineContentScript = config => config.main();
  run(source('entrypoints/youtube-main.content.js'));
  run('document.documentElement.setAttribute("data-bft-on", ""); document.documentElement.setAttribute("data-bft-remember-speed", ""); currentChannel = "UCfirst"; lastInputAt = performance.now(); document.documentElement.setAttribute("data-bft-default-speed", "1.5")');
  await sleep(0);
  assert.equal(saved, 0);
  assert.equal(player.querySelector('video').playbackRate, 1.5);
  run('document.dispatchEvent(new Event("yt-navigate-start")); history.pushState({}, "", "/watch?v=BBBBBBBBBBB")');
  assert.equal(run('watchChannel()'), null, 'old owner row is not assigned to the new video');
  player.getVideoData = () => ({ video_id: 'BBBBBBBBBBB', channel_id: 'UCsecond' });
  run('document.dispatchEvent(new Event("yt-navigate-finish"))'); await sleep(0);
  assert.equal(run('currentChannel'), 'UCsecond');
});

test('revealed tiles override hiding CSS without changing persisted settings', t => {
  const { ctx, run } = environment(t, '<div data-bft-blocked>hidden tile</div>');
  run('document.documentElement.setAttribute("data-bft-on", "")');
  const style = ctx.document.createElement('style');
  style.textContent = 'html[data-bft-on] [data-bft-blocked] { display:none !important }'; ctx.document.head.append(style);
  const tile = ctx.document.querySelector('[data-bft-blocked]');
  assert.equal(ctx.getComputedStyle(tile).display, 'none');
  const reveal = ctx.document.createElement('style');
  reveal.textContent = 'html[data-bft-on] [data-bft-blocked] { display:revert !important }'; ctx.document.head.append(reveal);
  assert.notEqual(ctx.getComputedStyle(tile).display, 'none');
  reveal.remove(); assert.equal(ctx.getComputedStyle(tile).display, 'none');
});
