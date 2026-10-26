// Isolated-world JS behaviors: the stuff CSS can't do. Each one reads its
// feature state live via isOn(), so it never needs settings passed in.
import { compileMatcher } from './blocklist.js';
import { isOn, onAttrChange, onNavigate, valueOf, waitFor } from './dom.js';
import { compileFilters } from './filters.js';
import { TILES } from './features.js';
import { loadSpeeds, onSpeedsChanged, saveSpeed } from './speeds.js';
import { interceptCopyShortcut, interceptShareClick, startWatchControls } from './watch-controls.js';
import { startSuggestionLimit } from './suggestions.js';
import { startWatchScrollbar } from './scrollbar.js';

const TILE_SELECTOR = TILES.join(',');

// ── Shorts → normal player ──────────────────────────────────────────────

const shortsToWatch = (href) => {
  const url = new URL(href, location.origin);
  const m = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  return m && `/watch?v=${m[1]}`;
};

// Covers hard loads, typed URLs, back/forward into a Short, and SPA navs we
// didn't intercept. replace() so Back doesn't bounce you into the Short again.
export function redirectIfShort() {
  if (!isOn('shorts-redirect')) return;
  const target = shortsToWatch(location.href);
  if (target) location.replace(target);
}

// Capture-phase click: runs before YouTube's router, so the Shorts player never
// even boots. Only plain left-clicks; ctrl/middle-click open a new tab, which
// then lands on redirectIfShort() at load anyway.
function interceptShortsClicks(e) {
  if (!isOn('shorts-redirect')) return;
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href^="/shorts/"]');
  const target = a && shortsToWatch(a.href);
  if (!target) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // YouTube's own capture listeners would SPA-nav anyway
  location.assign(target);
}

// ── Watch-page enforcement ──────────────────────────────────────────────

// One-shot per navigation, then hands control back to the user: if you
// re-enable autoplay mid-video, we don't fight you until the next video.
// AbortController kills the previous nav's pending waitFor()s, otherwise fast
// clicking through videos stacks up observers that resolve on the wrong page.
let navAbort;
const behaviorAborts = new Map();
function runWatchBehavior(id, fn) {
  behaviorAborts.get(id)?.abort();
  const controller = new AbortController();
  behaviorAborts.set(id, controller);
  if (location.pathname === '/watch' && isOn(id)) fn(controller.signal);
}

async function enforceAutoplay(signal) {
  if (!isOn('disable-autonav')) return;
  const btn = await waitFor('.ytp-autonav-toggle-button', { signal });
  if (!signal.aborted && isOn('disable-autonav') && btn?.getAttribute('aria-checked') === 'true')
    (btn.closest('button') ?? btn).click();
}
async function enforceTheater(signal) {
  if (!isOn('theater-default')) return;
  const flexy = await waitFor('ytd-watch-flexy', { signal });
  const button = flexy && await waitFor('.ytp-size-button', { signal });
  if (!signal.aborted && isOn('theater-default') && button && !flexy.hasAttribute('theater') && !document.fullscreenElement) button.click();
}
function onWatchPage() {
  navAbort?.abort();
  document.documentElement.removeAttribute('data-bft-no-scroll');
  for (const controller of behaviorAborts.values()) controller.abort();
  navAbort = new AbortController();
  if (location.pathname !== '/watch' || !isOn('on')) return;
  const { signal } = navAbort;
  onWatchSpeed(signal);
  startWatchControls(signal);
  startSuggestionLimit(signal);
  startWatchScrollbar(signal);
  runWatchBehavior('disable-autonav', enforceAutoplay);
  runWatchBehavior('theater-default', enforceTheater);
}

export function redirectIfHome() {
  if (isOn('home-to-subs') && location.pathname === '/') location.replace('/feed/subscriptions');
}

function interceptHomeClicks(e) {
  if (!isOn('home-to-subs') || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href="/"]'); // logo + "Home" guide entry
  if (!a || (a.target && a.target !== '_self')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // Click YouTube's own Subscriptions link → SPA navigation, no full reload.
  // Fallback for when the guide isn't rendered (collapsed / narrow window).
  const subs = document.querySelector('a[href="/feed/subscriptions"]');
  if (subs) subs.click();
  else location.assign('/feed/subscriptions');
}

// ── Per-channel speed memory ────────────────────────────────────────────
// Split across worlds: this side knows the channel + storage, the MAIN world
// side (youtube-main.content.js) owns the player API. They talk through the
// SPEED_ATTR attribute on <html>, same channel as every feature flag.

// = attrFor('channel-speed'); the MAIN world reads it as valueOf('channel-speed')
export const SPEED_ATTR = 'data-bft-channel-speed';
let speeds = {};
let currentChannel = null;
let navigated = false;
// -Infinity, not 0: performance.now() starts at page load, so with 0 every
// ratechange in the first second (exactly when YouTube restores its own stored
// rate) would look like it followed user input. Caught by the e2e suite.
let lastInputAt = -Infinity;

// A ratechange is only a USER choice if real input happened just before it.
// YouTube itself fires ratechange when it restores its own stored rate on video
// load; recording those would save "1×" for every channel you open.
const markInput = (e) => {
  if (!e.isTrusted) return;
  const speedKey = e.type === 'keydown' && ['>', '<'].includes(e.key);
  const speedControl = e.type === 'pointerup' && e.target.closest?.('#movie_player .ytp-menuitem, #movie_player input');
  if (speedKey || speedControl) lastInputAt = performance.now();
};

function watchChannel() {
  const root = document.documentElement;
  const id = new URLSearchParams(location.search).get('v');
  if (root.getAttribute('data-bft-video-id') !== id) return null;
  if (root.getAttribute('data-bft-channel-id')) return root.getAttribute('data-bft-channel-id');
  // Never attach a recycled owner row to a new video without player identity.
  if (navigated) return null;
  const owner = document.querySelector('ytd-watch-metadata ytd-video-owner-renderer, ytd-video-owner-renderer');
  if (!owner) return null;
  return handleFrom(owner) || owner.querySelector('a[href^="/channel/"]')?.getAttribute('href').split('/')[2] || null;
}

function publishChannelSpeed() {
  const rate = isOn('remember-speed') && currentChannel ? speeds[currentChannel] : undefined;
  const root = document.documentElement;
  if (rate) root.setAttribute(SPEED_ATTR, String(rate));
  else root.removeAttribute(SPEED_ATTR);
}

async function onWatchSpeed(signal) {
  currentChannel = null; // never attribute a change to the previous video's channel
  publishChannelSpeed();
  if (!isOn('remember-speed')) return;
  // yt-navigate-finish fires after page data is applied, but the owner row
  // re-renders a beat later on some navs, so wait for the link to exist.
  const owner = await waitFor('ytd-video-owner-renderer a[href^="/@"], ytd-video-owner-renderer a[href^="/channel/"]', { signal });
  if (!owner || signal?.aborted || !isOn('remember-speed') || location.pathname !== '/watch') return;
  currentChannel = watchChannel();
  publishChannelSpeed();
}

function onRateChange(e) {
  const video = e.target;
  if (!(video instanceof HTMLVideoElement) || !video.closest('#movie_player') || !isOn('remember-speed') || !currentChannel) return;
  if (location.pathname !== '/watch') return;
  if (document.getElementById('movie_player')?.classList.contains('ad-showing')) return;
  if (performance.now() - lastInputAt > 1000) return; // not user-initiated
  const rate = video.playbackRate;
  const fallback = Number(valueOf('default-speed')) || 1;
  // Choosing the default again = forget the override for this channel.
  // Update the local cache immediately (new object, not mutation) so
  // publishChannelSpeed sees it before storage.onChanged round-trips.
  const forget = rate === fallback;
  const { [currentChannel]: _, ...rest } = speeds;
  speeds = forget ? rest : { ...rest, [currentChannel]: rate };
  saveSpeed(currentChannel, forget ? null : rate).catch(err => toast(`Could not save speed: ${err.message}`));
  publishChannelSpeed();
}

export async function startSpeedMemory() {
  let changed = false;
  onSpeedsChanged(next => { changed = true; speeds = next; publishChannelSpeed(); });
  onAttrChange(['remember-speed', 'channel-id', 'video-id'], () => onWatchSpeed(navAbort?.signal));
  const loaded = await loadSpeeds();
  if (!changed) speeds = loaded;
  publishChannelSpeed();
}

const BLOCKED = 'data-bft-blocked';
const FILTERED = 'data-bft-filtered';

const text = (el) => (el?.textContent ?? '').trim();

function handleFrom(root) {
  const href = root.querySelector('a[href^="/@"]')?.getAttribute('href');
  if (!href) return '';
  try {
    return decodeURIComponent(href.slice(1).split(/[/?#]/)[0]); // "/@foo/videos" → "@foo"
  } catch {
    return ''; // malformed %-escape; channel name still works
  }
}

// Pull matchable fields from a tile. Two layouts in the wild: classic ytd-*
// renderers (#video-title, ytd-channel-name, #metadata-line) and the newer
// lockup view-models whose class names carry version suffixes (-wiz etc.),
// hence the [class*=] selectors.
const META_SELECTOR =
  '#metadata-line span, .ytContentMetadataViewModelMetadataText, [class*="content-metadata-view-model"][class*="__metadata-text"]';
const DURATION_SELECTOR =
  'ytd-thumbnail-overlay-time-status-renderer #text, yt-thumbnail-badge-view-model .ytBadgeShapeBadgeText, yt-thumbnail-badge-view-model .ytBadgeShapeText, ytd-thumbnail-overlay-time-status-renderer [class*="badge-shape"][class*="__text"], yt-thumbnail-badge-view-model [class*="badge-shape"][class*="__text"]';

export function readTile(tile) {
  const titleEl = tile.querySelector('#video-title, .ytLockupMetadataViewModelTitle, [class*="lockup-metadata-view-model"][class*="__title"]');
  return {
    title: (titleEl?.getAttribute('title') || text(titleEl)).trim(),
    channel: text(
      tile.querySelector('ytd-channel-name #text, .ytContentMetadataViewModelMetadataText, [class*="content-metadata-view-model"][class*="__metadata-text"]'),
    ),
    handle: handleFrom(tile),
    channelId: tile.querySelector('a[href^="/channel/"]')?.getAttribute('href').split('/')[2] || '',
    durationText: text(tile.querySelector(DURATION_SELECTOR)),
    metaTexts: [...tile.querySelectorAll(META_SELECTOR)].map(text),
  };
}

// Two independent verdicts per tile, each with its own attribute so CSS can
// gate them separately (blocklist toggle vs. master switch).
let matcher = null; // blocklist: title/channel → bool
let filter = null; // filters.js: duration/views/age/allowlist → bool
let lists = { keywords: [], channels: [], allow: [] };

// Per-tile signature of what we last evaluated. YouTube RECYCLES tile elements
// (same node, new video) on SPA nav and in the sidebar, so "already processed
// this node" is wrong; "already processed this content" is right. WeakMap so
// detached tiles get GC'd instead of leaking for the tab's lifetime.
let seen = new WeakMap();
let scanTimer = 0;
const dirtyTiles = new Set();
function markDirty(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el) return;
  for (let tile = el.closest?.(TILE_SELECTOR); tile; tile = tile.parentElement?.closest(TILE_SELECTOR)) dirtyTiles.add(tile);
  for (const tile of el.querySelectorAll?.(TILE_SELECTOR) ?? []) dirtyTiles.add(tile);
}
function scan() {
  scanTimer = 0;
  if (!matcher && !filter) { dirtyTiles.clear(); return; }
  const started = performance.now();
  for (const tile of [...dirtyTiles].slice(0, 100)) {
    dirtyTiles.delete(tile);
    if (!tile.isConnected) continue;
    const info = readTile(tile);
    const sig = JSON.stringify(info);
    if (seen.get(tile) === sig) continue;
    seen.set(tile, sig);
    tile.toggleAttribute(BLOCKED, Boolean(matcher?.(info)));
    tile.toggleAttribute(FILTERED, Boolean(filter?.(info)));
    if (performance.now() - started >= 8) break;
  }
  if (dirtyTiles.size) scheduleScan();
}
const scheduleScan = () => {
  if (!scanTimer && dirtyTiles.size) scanTimer = setTimeout(scan, 100);
};
const scanObserver = new MutationObserver(records => {
  for (const record of records) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    for (let tile = target?.closest?.(TILE_SELECTOR); tile; tile = tile.parentElement?.closest(TILE_SELECTOR)) dirtyTiles.add(tile);
    for (const node of record.addedNodes ?? []) markDirty(node);
  }
  scheduleScan();
});

// Rebuild both predicates. Filter thresholds come from <html> attrs (same
// channel as every other feature), lists come from settings.
function rebuild() {
  matcher = isOn('on') && isOn('blocklist') ? compileMatcher(lists) : null;
  const num = (id) => Number(valueOf(id)) || 0; // attr absent → null → 0 = off
  filter = isOn('on') ? compileFilters({
    minMinutes: num('filter-min-duration'),
    maxMinutes: num('filter-max-duration'),
    minViews: num('filter-min-views'),
    maxAgeDays: num('filter-max-age'),
    allow: isOn('allowlist-mode') ? lists.allow : null,
  }) : null;
  dirtyTiles.clear();
  clearTimeout(scanTimer); scanTimer = 0;
  seen = new WeakMap(); // inputs changed → every cached verdict is stale
  if (!matcher && !filter) {
    scanObserver.disconnect(); // nothing to match = zero ongoing cost
    for (const el of document.querySelectorAll(`[${BLOCKED}], [${FILTERED}]`)) {
      el.removeAttribute(BLOCKED);
      el.removeAttribute(FILTERED);
    }
    return;
  }
  scanObserver.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'title', 'aria-label'] });
  markDirty(document.documentElement);
  scheduleScan();
}

export function setLists(next) {
  lists = next;
  rebuild();
}

const FILTER_IDS = ['on', 'blocklist', 'filter-min-duration', 'filter-max-duration', 'filter-min-views', 'filter-max-age', 'allowlist-mode'];

// ── Right-click → "Block this channel" ──────────────────────────────────

// The context-menu click arrives in the background script with no DOM info,
// so remember what was right-clicked here and answer when asked.
let lastContextTarget = null;

export function channelAt(el) {
  const tile = el?.closest?.(TILE_SELECTOR);
  if (tile) {
    const { channel, handle } = readTile(tile);
    return handle || channel || null;
  }
  // Watch page: channel row under the player
  const owner = el?.closest?.('ytd-video-owner-renderer, ytd-watch-metadata');
  if (owner) return handleFrom(owner) || text(owner.querySelector('ytd-channel-name #text')) || null;
  return null;
}

export function blockTargetChannel() {
  return channelAt(lastContextTarget);
}

// ── Toast ───────────────────────────────────────────────────────────────

export function toast(message, undo) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message; // textContent, never innerHTML: channel names are user content
  el.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'background:#18181b;color:#ececee;border:1px solid #27272a;border-radius:8px;' +
    'padding:10px 16px;font:14px system-ui,sans-serif;box-shadow:0 4px 16px #0008';
  if (undo) {
    const button = document.createElement('button');
    button.textContent = 'Undo'; button.style.marginLeft = '12px';
    button.onclick = async () => {
      button.disabled = true;
      try { await undo(); el.remove(); } catch (err) { toast(`Could not undo: ${err.message}`); button.disabled = false; }
    };
    el.append(button);
  }
  (document.body ?? document.documentElement).append(el);
  setTimeout(() => el.remove(), undo ? 12000 : 4000);
}

function copiedToast() {
  document.getElementById('bft-link-copied')?.remove();
  const el = document.createElement('div');
  el.id = 'bft-link-copied';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const check = document.createElement('span');
  check.setAttribute('aria-hidden', 'true');
  check.textContent = '✓';
  check.style.cssText = 'color:#8ee0ae;font-size:16px;line-height:1';
  const label = document.createElement('span');
  label.textContent = 'Link Copied!';
  el.append(check, label);
  el.style.cssText =
    'position:fixed;bottom:30px;left:50%;transform:translate(-50%,10px);z-index:2147483647;' +
    'display:flex;align-items:center;gap:8px;pointer-events:none;padding:9px 14px;' +
    'border:1px solid #44464d;border-radius:999px;background:#1d1f24ed;color:#fff;' +
    'font:600 13px system-ui,sans-serif;letter-spacing:.01em;box-shadow:0 8px 28px #0009;' +
    'backdrop-filter:blur(12px)';
  (document.body ?? document.documentElement).append(el);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !el.animate) {
    el.style.transform = 'translateX(-50%)';
    setTimeout(() => el.remove(), 1600);
    return;
  }
  const animation = el.animate([
    { opacity: 0, transform: 'translate(-50%,10px) scale(.96)', offset: 0 },
    { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: .18 },
    { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: .76 },
    { opacity: 0, transform: 'translate(-50%,-8px) scale(.98)', offset: 1 },
  ], { duration: 1900, easing: 'ease-in-out', fill: 'forwards' });
  animation.onfinish = () => el.remove();
}

// ── Diagnostics (popup asks "how many elements does each toggle match here?") ──

// Built-in features keyed by id; user rules keyed `rule:<id>`.
export function diagnose(features, rules = [], { selectors = true } = {}) {
  const counts = {};
  const invalid = [];
  const measure = (key, selectors) => {
    const hits = new Set(); // dedupe: one element can match several selectors
    for (const s of selectors) {
      try {
        for (const el of document.querySelectorAll(s)) hits.add(el);
      } catch {
        invalid.push(key); // selector this engine can't parse → its CSS rule is dead
        break;
      }
    }
    counts[key] = hits.size;
  };
  if (selectors) {
    for (const f of features) if (f.hide) measure(f.id, f.hide);
    for (const r of rules) measure(`rule:${r.id}`, [r.selector]);
  }
  return { counts, invalid, path: location.pathname, language: document.documentElement.lang || 'unknown', hidden: {
    blocklist: document.querySelectorAll(`[${BLOCKED}]`).length,
    filters: document.querySelectorAll(`[${FILTERED}]`).length,
  } };
}

// ── Wiring ──────────────────────────────────────────────────────────────

export function startBehaviors() {
  document.addEventListener('click', (event) => interceptShareClick(event, toast), true);
  document.addEventListener('keydown', (event) => interceptCopyShortcut(event, toast, copiedToast), true);
  document.addEventListener('click', interceptShortsClicks, true);
  document.addEventListener('click', interceptHomeClicks, true);
  document.addEventListener('contextmenu', (e) => (lastContextTarget = e.target), true);
  // Media events don't bubble but do capture: one listener for every <video>.
  document.addEventListener('ratechange', onRateChange, true);
  for (const type of ['keydown', 'pointerup']) document.addEventListener(type, markInput, true);
  onAttrChange(FILTER_IDS, rebuild);
  onAttrChange(['on'], onWatchPage);
  onAttrChange(['home-to-subs'], redirectIfHome);
  onAttrChange(['shorts-redirect'], redirectIfShort);
  onAttrChange(['disable-autonav'], () => runWatchBehavior('disable-autonav', enforceAutoplay));
  onAttrChange(['theater-default'], () => runWatchBehavior('theater-default', enforceTheater));
  startSpeedMemory().catch(err => toast(`Could not load speeds: ${err.message}`));
  document.addEventListener('bft:rate-applying', () => { lastInputAt = -Infinity; });
  document.addEventListener('yt-navigate-start', () => {
    navAbort?.abort(); navigated = true; currentChannel = null; lastInputAt = -Infinity; publishChannelSpeed();
    for (const controller of behaviorAborts.values()) controller.abort();
  });
  onNavigate(() => {
    redirectIfShort();
    redirectIfHome();
    onWatchPage();
  });
}

// Called once, after the first settings apply: yt-navigate-finish may fire
// before the async storage read resolves, so that first nav would be missed.
export function runBehaviorsNow() {
  redirectIfShort();
  redirectIfHome();
  onWatchPage();
}
