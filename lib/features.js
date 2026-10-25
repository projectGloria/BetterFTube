import { isSafeSelector } from './validation.js';
// The toggle list: the single source of truth.
// The popup renders from it, the content script generates CSS from it, and
// settings defaults are derived from it. Adding a toggle = adding one object.
//
// When YouTube ships a redesign, THIS is the only file that should need edits.
//
// Feature shape:
//   id      kebab-case, becomes the <html data-bft-{id}> attribute. Keep it
//           kebab: HTML lowercases attribute names, so camelCase would silently
//           mismatch between setAttribute and the generated selector.
//   group   popup section (must match a GROUPS id)
//   label   popup text
//   hint    optional one-liner shown under the label
//   type    'toggle' (default), 'select' or 'number'
//   options select only: [{ value, label }]. The value 'off' means disabled.
//   min/max/step/unit  number only. The value 0 means disabled.
//   origins optional host patterns the feature needs. Requested at runtime when
//           the user enables it (optional_host_permissions), never at install.
//   default initial state for fresh installs (and for toggles added in updates)
//   hide    optional selectors to display:none. Each one gets prefixed with the
//           attribute gate, so write them as if they were unconditional.
//           Features without `hide` are JS behaviors (see lib/behaviors.js and
//           entrypoints/youtube-main.content.js); they read the same attribute.
//
// Selector notes:
// - Prefer stable custom-element tag names (ytd-*, yt-*, ytm-*) and YouTube's own
//   state attributes ([overlay-style="SHORTS"], [is-shorts]) over ids/classes.
// - Avoid localized text (title="Shorts") as the ONLY hook; it breaks for
//   non-English UIs. Pair it with an href/attribute hook where possible.
// - `:has()` is fine (Chromium 105+, Firefox 121+), but keep the subject narrow:
//   `ytd-rich-item-renderer:has(...)` instead of `*:has(...)`, otherwise style
//   recalc on YouTube's huge DOM gets expensive on every mutation.
// - Cross-checked against community filter lists (gijsdev/ublock-hide-yt-shorts,
//   yokoffing/filterlists), 2026-04. Still verify on live YouTube via popup counts.

export const GROUPS = [
  { id: 'feed', label: 'Feed' },
  { id: 'filters', label: 'Filters' },
  { id: 'watch', label: 'Watch page' },
  { id: 'player', label: 'Player' },
  { id: 'nav', label: 'Navigation' },
  // Popup appends the user's own hide rules to this group
  { id: 'custom', label: 'Custom' },
  { id: 'network', label: 'Online (opt-in)' },
];

// Third-party APIs. Kept in one place so manifest, permission prompts and
// fetches can't drift apart.
export const ORIGINS = {
  sponsorblock: 'https://sponsor.ajay.app/*',
  dislikes: 'https://returnyoutubedislikeapi.com/*',
};

// Every renderer YouTube uses for a single video tile, across home grid,
// search, subscriptions, and the watch-page sidebar (old + new lockup layout).
export const TILES = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
];

// "Hide any tile containing X". Expands to one selector per tile type.
const tilesWith = (...inner) => TILES.map((t) => `${t}:has(${inner.join(', ')})`);

export const FEATURES = [
  // ── Feed ──────────────────────────────────────────────────────────────
  {
    id: 'hide-shorts',
    group: 'feed',
    label: 'Hide Shorts',
    hint: 'Shelves, search results, sidebar entry, channel tab',
    default: true,
    hide: [
      // Home grid shelf (old + new renderer names; YT A/B tests both)
      'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)',
      // Search + watch-sidebar shelves
      'ytd-reel-shelf-renderer',
      'grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)',
      // Individual Shorts mixed into regular lists: YouTube flags them itself
      // with overlay-style="SHORTS" on the duration badge. href is the fallback.
      ...tilesWith('[overlay-style="SHORTS"]', 'a[href^="/shorts/"]'),
      // Left guide + collapsed mini guide
      'ytd-guide-entry-renderer:has(a[href^="/shorts"], [title="Shorts"])',
      'ytd-mini-guide-entry-renderer:has(a[href^="/shorts"], [title="Shorts"])',
      'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
      // Channel page tab
      'yt-tab-shape[tab-title="Shorts"]',
    ],
  },
  {
    id: 'shorts-redirect',
    group: 'feed',
    label: 'Open Shorts in normal player',
    hint: '/shorts/ID → /watch?v=ID (seek bar, quality, speed)',
    default: true,
  },
  {
    id: 'home-to-subs',
    group: 'feed',
    label: 'Home → Subscriptions',
    hint: 'Logo, Home link and youtube.com/ open your subscriptions',
    default: false,
  },
  {
    id: 'hide-chips',
    group: 'feed',
    label: 'Hide category chips',
    hint: 'The "All / Music / Gaming…" pill bar',
    default: true,
    hide: [
      'ytd-feed-filter-chip-bar-renderer',
      // Watch-page sidebar variant
      'yt-related-chip-cloud-renderer',
      // Blurred backdrop that sits behind the chip bar; leaves a blank strip otherwise
      '#frosted-glass.with-chipbar',
    ],
  },
  {
    id: 'disable-hover-effects',
    group: 'feed',
    label: 'Disable video hover effects',
    hint: 'No highlight, zoom or inline preview when hovering videos (home, search, watch sidebar)',
    default: false,
    // Pure CSS, generated in buildStylesheet() below (not display:none, so no `hide`).
  },
  {
    id: 'blocklist',
    group: 'feed',
    label: 'Apply blocklist',
    hint: 'Keywords & channels, edit in Options (or right-click a video)',
    default: true,
    // Tiles are MARKED by JS (lib/blocklist.js) and HIDDEN by CSS through this
    // gate, so toggling it off unhides instantly without a rescan.
    hide: ['[data-bft-blocked]'],
  },
  {
    id: 'hide-watched',
    group: 'feed',
    label: 'Hide watched videos',
    hint: 'Anything watched 90% or more',
    default: false,
    // CSS-only threshold trick: the red resume bar is an inline `width: N%`.
    // `width: 9` + not `width: 9%` matches 90–99, plus an explicit 100%. Widths are
    // integer percentages in practice, so this holds; a JS pass would buy nothing.
    hide: ['#progress', '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment'].flatMap(
      (bar) =>
        tilesWith(`${bar}[style*="width: 100%"]`, `${bar}[style*="width: 9"]:not([style*="width: 9%"])`),
    ),
  },
  {
    id: 'hide-mixes',
    group: 'feed',
    label: 'Hide Mixes',
    hint: 'Auto-generated radio playlists',
    default: false,
    hide: [
      // Mixes are the only tiles linking with start_radio=1
      ...tilesWith('a[href*="start_radio=1"]'),
      'ytd-radio-renderer',
      'ytd-compact-radio-renderer',
      // End-of-video wall
      '.ytp-videowall-still[data-is-mix="true"]',
    ],
  },
  {
    id: 'hide-live',
    group: 'feed',
    label: 'Hide live streams',
    default: false,
    hide: tilesWith('[overlay-style="LIVE"]', '.badge-style-type-live-now-alternate'),
  },
  {
    id: 'hide-upcoming',
    group: 'feed',
    label: 'Hide upcoming & premieres',
    hint: 'Scheduled streams with "Notify me"',
    default: false,
    hide: tilesWith('[overlay-style="UPCOMING"]'),
  },
  {
    id: 'hide-members-only',
    group: 'feed',
    label: 'Hide members-only videos',
    default: true,
    hide: tilesWith('.badge-style-type-members-only'),
  },
  {
    id: 'hide-posts',
    group: 'feed',
    label: 'Hide community posts',
    hint: 'Text/image posts mixed into the home feed',
    default: false,
    hide: [
      'ytd-rich-section-renderer:has(ytd-post-renderer, ytd-backstage-post-thread-renderer)',
      'ytd-rich-item-renderer:has(ytd-post-renderer, ytd-backstage-post-thread-renderer)',
    ],
  },
  {
    id: 'hide-playables',
    group: 'feed',
    label: 'Hide Playables (games)',
    default: true,
    hide: [
      'ytd-rich-section-renderer:has(a[href^="/playables"])',
      'ytd-guide-entry-renderer:has(a[href^="/playables"])',
    ],
  },
  {
    id: 'hide-promos',
    group: 'feed',
    label: 'Hide promos & banners',
    hint: 'Premium upsells, masthead ads, statement banners',
    default: true,
    hide: [
      '#masthead-ad',
      'ytd-banner-promo-renderer',
      'ytd-statement-banner-renderer',
      'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
      'ytd-mealbar-promo-renderer',
      'ytd-primetime-promo-renderer',
      'ytd-brand-video-singleton-renderer',
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    ],
  },

  // ── Filters (JS: lib/filters.js parses each tile, marks data-bft-filtered) ──
  // Parsing reads English UI text ("1.2M views", "3 days ago"). Tiles whose text
  // can't be parsed are never hidden: fail open, not closed.
  {
    id: 'filter-min-duration',
    group: 'filters',
    type: 'number',
    label: 'Hide shorter than',
    unit: 'min',
    min: 0,
    max: 600,
    step: 1,
    default: 0,
  },
  {
    id: 'filter-max-duration',
    group: 'filters',
    type: 'number',
    label: 'Hide longer than',
    unit: 'min',
    min: 0,
    max: 6000,
    step: 5,
    default: 0,
  },
  {
    id: 'filter-min-views',
    group: 'filters',
    type: 'number',
    label: 'Hide fewer views than',
    unit: 'views',
    min: 0,
    max: 1e10,
    step: 100,
    default: 0,
  },
  {
    id: 'filter-max-age',
    group: 'filters',
    type: 'number',
    label: 'Hide older than',
    unit: 'days',
    min: 0,
    max: 36500,
    step: 1,
    default: 0,
  },
  {
    id: 'allowlist-mode',
    group: 'filters',
    label: 'Allowlist mode',
    hint: 'Only show channels from your allowlist (edit in Options)',
    default: false,
  },

  // ── Watch page ────────────────────────────────────────────────────────
  {
    id: 'hide-notification-bell',
    group: 'watch',
    label: 'Hide subscription bell',
    default: true,
    hide: [
      'ytd-watch-flexy #notification-preference-button',
      'ytd-watch-metadata yt-subscription-notification-toggle-button-renderer',
      'ytd-watch-metadata ytd-subscription-notification-toggle-button-renderer',
      'ytd-watch-flexy .bft-notification-bell',
      'ytd-watch-flexy ytd-video-owner-renderer [aria-label*="notification" i]',
      'ytd-watch-flexy ytd-video-owner-renderer [title*="notification" i]',
    ],
  },
  {
    id: 'hide-like-dislike',
    group: 'watch',
    label: 'Hide like and dislike',
    default: true,
    hide: [
      'ytd-watch-metadata segmented-like-dislike-button-view-model',
      'ytd-watch-metadata ytd-segmented-like-dislike-button-renderer',
      'ytd-watch-metadata .bft-like-dislike',
    ],
  },
  {
    id: 'hide-join-button',
    group: 'watch',
    label: 'Hide Join button',
    hint: 'Channel membership button next to the channel name',
    default: false,
    hide: [
      // #sponsor-button is YouTube's own id for the membership button (locale-proof)
      'ytd-watch-metadata #sponsor-button',
      'ytd-watch-flexy ytd-video-owner-renderer #sponsor-button',
      'ytd-watch-flexy #owner #sponsor-button',
    ],
  },
  {
    id: 'minimal-share',
    group: 'watch',
    label: 'Share icon copies link',
    hint: 'No share dialog',
    default: true,
  },
  {
    id: 'hide-share-button',
    group: 'watch',
    label: 'Hide Share button',
    hint: 'Ctrl+C copies the short video link when nothing is selected',
    default: false,
    hide: [
      'ytd-watch-metadata #share-button',
      'ytd-watch-metadata .bft-share-control',
    ],
  },
  {
    id: 'hide-save-button',
    group: 'watch',
    label: 'Hide Save button',
    default: true,
    hide: [
      'ytd-watch-metadata #save-button',
      'ytd-watch-metadata .bft-save-button',
    ],
  },
  {
    id: 'hide-more-actions',
    group: 'watch',
    label: 'Hide three-dot menu',
    default: true,
    hide: [
      'ytd-watch-flexy #top-row ytd-menu-renderer yt-button-shape#button-shape',
      'ytd-watch-metadata ytd-menu-renderer yt-icon-button#button',
      'ytd-watch-metadata ytd-menu-renderer button[aria-label*="more actions" i]',
      'ytd-watch-metadata ytd-menu-renderer button[aria-label*="more options" i]',
      'ytd-watch-flexy .bft-more-actions',
    ],
  },
  {
    id: 'hide-description',
    group: 'watch',
    label: 'Hide description',
    default: false,
    hide: [
      'ytd-watch-metadata #description',
      'ytd-watch-metadata #description-inner',
      'ytd-watch-metadata ytd-text-inline-expander#description-inline-expander',
    ],
  },
  {
    id: 'title-alignment',
    group: 'watch',
    type: 'select',
    label: 'Video title alignment',
    default: 'left',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ],
  },
  {
    id: 'channel-alignment',
    group: 'watch',
    type: 'select',
    label: 'Channel row alignment',
    default: 'left',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ],
  },
  {
    id: 'hide-comments',
    group: 'watch',
    label: 'Hide comments',
    default: false,
    hide: ['ytd-comments#comments'],
  },
  {
    id: 'hide-related',
    group: 'watch',
    label: 'Hide related videos',
    hint: 'Sidebar recommendations (playlist panel stays)',
    default: false,
    // #related only, not #secondary: the playlist/chat panels live in #secondary too
    hide: ['#secondary #related'],
  },
  {
    id: 'limit-suggestions',
    group: 'watch',
    type: 'number',
    label: 'Limit suggested videos',
    hint: '0 = unlimited; limits the right panel only',
    unit: 'videos',
    min: 0,
    max: 200,
    step: 1,
    default: 0,
  },
  {
    id: 'hide-endscreen',
    group: 'watch',
    label: 'Hide end-screen cards',
    hint: 'Overlays in the last 20s + the video wall at the end',
    default: true,
    hide: ['.ytp-ce-element', '.html5-endscreen', '.ytp-fullscreen-grid'],
  },
  {
    id: 'hide-infocards',
    group: 'watch',
    label: 'Hide info cards & watermark',
    default: true,
    hide: ['.ytp-cards-teaser', '.ytp-cards-button', '.iv-branding', '.ytp-button.branding-img-container'],
  },
  {
    id: 'hide-merch',
    group: 'watch',
    label: 'Hide merch, products & donations',
    default: true,
    hide: ['ytd-merch-shelf-renderer', '.ytp-suggested-action-badge-expanded', '#donation-shelf'],
  },
  {
    id: 'hide-hashtags',
    group: 'watch',
    label: 'Hide hashtags above title',
    default: true,
    hide: ['ytd-watch-metadata #super-title'],
  },
  {
    id: 'hide-live-chat',
    group: 'watch',
    label: 'Hide live chat',
    default: false,
    hide: ['ytd-live-chat-frame#chat', '#chat-container'],
  },

  // ── Player ────────────────────────────────────────────────────────────
  {
    id: 'disable-autonav',
    group: 'player',
    label: 'Disable autoplay next',
    hint: 'Turns off the autoplay switch when a video opens',
    default: true,
  },
  {
    id: 'theater-default',
    group: 'player',
    label: 'Theater mode by default',
    default: false,
  },
  {
    id: 'default-quality',
    group: 'player',
    type: 'select',
    label: 'Default quality',
    hint: 'Falls back to the best available below it',
    default: 'off',
    // Values are YouTube's internal quality ids, passed straight to the player API.
    options: [
      { value: 'off', label: 'Auto' },
      { value: 'max', label: 'Max' },
      { value: 'hd2160', label: '2160p' },
      { value: 'hd1440', label: '1440p' },
      { value: 'hd1080', label: '1080p' },
      { value: 'hd720', label: '720p' },
      { value: 'large', label: '480p' },
      { value: 'medium', label: '360p' },
    ],
  },
  {
    id: 'hide-premium-quality',
    group: 'player',
    label: 'Hide Premium-only qualities',
    hint: '"1080p Premium" entries in the quality menu',
    default: true,
    hide: ['.ytp-quality-menu .ytp-menuitem:has(.ytp-premium-label)'],
  },

  {
    id: 'default-speed',
    group: 'player',
    type: 'select',
    label: 'Default speed',
    default: 'off',
    options: [
      { value: 'off', label: 'YouTube' },
      { value: '1', label: '1× (normal)' },
      { value: '1.25', label: '1.25×' },
      { value: '1.5', label: '1.5×' },
      { value: '1.75', label: '1.75×' },
      { value: '2', label: '2×' },
      { value: '2.5', label: '2.5×' },
      { value: '3', label: '3×' },
    ],
  },
  {
    id: 'remember-speed',
    group: 'player',
    label: 'Remember speed per channel',
    hint: 'Change speed once, it sticks for that channel',
    default: false,
  },

  // ── Navigation ────────────────────────────────────────────────────────
  {
    id: 'hide-explore',
    group: 'nav',
    label: 'Hide "Explore" section',
    hint: 'Sidebar block with Trending, Music, Gaming…',
    default: true,
    hide: [
      'ytd-guide-section-renderer:has(a[href^="/feed/trending"])',
      'ytd-guide-section-renderer:has(a[href^="/gaming"])',
    ],
  },
  {
    id: 'hide-more-from-yt',
    group: 'nav',
    label: 'Hide "More from YouTube"',
    hint: 'Premium, Studio, Music, Kids links',
    default: true,
    hide: [
      'ytd-guide-section-renderer:has(a[href*="studio.youtube.com"])',
      'ytd-guide-section-renderer:has(a[href*="music.youtube.com"])',
    ],
  },
  {
    id: 'hide-guide-footer',
    group: 'nav',
    label: 'Hide sidebar footer',
    hint: 'About / Press / Copyright link wall',
    default: true,
    hide: ['ytd-guide-renderer #footer'],
  },
  {
    id: 'hide-notifications',
    group: 'nav',
    label: 'Hide notifications bell',
    default: false,
    hide: ['ytd-notification-topbar-button-renderer'],
  },
  {
    id: 'hide-create',
    group: 'nav',
    label: 'Hide "Create" button',
    default: false,
    // UNVERIFIED-ish: the Create button is the plain ytd-button-renderer in
    // the masthead's #buttons; avatar/bell use dedicated renderers.
    hide: ['ytd-masthead #buttons > ytd-button-renderer'],
  },
  {
    id: 'hide-voice-search',
    group: 'nav',
    label: 'Hide voice search mic',
    default: true,
    hide: ['#voice-search-button'],
  },

  // ── Custom ────────────────────────────────────────────────────────────
  {
    id: 'custom-css',
    group: 'custom',
    label: 'Apply custom CSS',
    hint: 'Your own stylesheet, edit in Options',
    default: true,
  },

  // ── Online (opt-in) ───────────────────────────────────────────────────
  // The ONLY features that make network requests. Off by default; enabling one
  // triggers a host-permission prompt for exactly its API origin.
  {
    id: 'sponsorblock',
    group: 'network',
    type: 'select',
    label: 'SponsorBlock',
    hint: 'Auto-skip segments (sponsor.ajay.app)',
    default: 'off',
    origins: [ORIGINS.sponsorblock],
    // Values are SponsorBlock category ids, passed straight to the API.
    options: [
      { value: 'off', label: 'Off' },
      { value: 'sponsor', label: 'Sponsors' },
      { value: 'sponsor,selfpromo,interaction', label: '+ promo, sub reminders' },
      { value: 'sponsor,selfpromo,interaction,intro,outro,preview,filler', label: 'Everything' },
    ],
  },
  {
    id: 'dislikes',
    group: 'network',
    label: 'Show dislike count',
    hint: 'Estimated, via returnyoutubedislikeapi.com',
    default: false,
    origins: [ORIGINS.dislikes],
  },
];

// Hover-effect killers, one rule per selector (see buildStylesheet). Gated by
// data-bft-disable-hover-effects. Best-effort against YouTube's class names,
// which are churny: if one effect survives, inspect it and add its selector here.
export const HOVER_RULES = [
  // Inline autoplay preview that pops over the thumbnail
  // :is() so the comma can't leak out of the attribute gate
  ':is(ytd-video-preview, #video-preview) { display: none !important; }',
  // Hover tint/overlay + rounded-corner "expand" on the new lockup layout
  `:is(${TILES.join(', ')}):hover { background: none !important; transform: none !important; }`,
  `:is(${TILES.join(', ')}):hover :is(#dismissible, .yt-lockup-view-model__content-image, yt-thumbnail-view-model, ytd-thumbnail, #thumbnail) { background: none !important; transform: none !important; border-radius: inherit !important; }`,
  `:is(${TILES.join(', ')}) :is(yt-thumbnail-view-model, ytd-thumbnail, #thumbnail) :is(img, yt-image) { transform: none !important; transition: none !important; }`,
  // Dark scrim on the thumbnail while hovered
  `:is(${TILES.join(', ')}):hover :is(.yt-thumbnail-view-model__hover-overlay, yt-thumbnail-hover-overlay-toggled-text-view-model, #hover-overlays) { display: none !important; }`,
  // Hover background drawn by the pseudo-element on the link wrappers
  `:is(${TILES.join(', ')}) :is(a#thumbnail, a.yt-lockup-view-model__content-image, a.yt-lockup-metadata-view-model__title)::before { display: none !important; }`,
];

export const attrFor = (id) => `data-bft-${id}`;

// Settings value → <html> attribute value. null = attribute absent = feature off.
// Toggles get '' (presence is the signal); selects carry their value so the
// MAIN-world script can read it without chrome.storage access.
export function attrValue(feature, value) {
  if (feature.type === 'select') return value && value !== 'off' ? value : null;
  if (feature.type === 'number') return value > 0 ? String(value) : null;
  return value ? '' : null;
}

// Is a stored value "on"? Shared by popup counts and presets.
export const isActiveValue = (v) => (typeof v === 'number' ? v > 0 : Boolean(v) && v !== 'off');

// Master switch attribute. Gates rules that don't belong to a single feature
// (filter marks, user rules).
export const ON_ATTR = 'data-bft-on';

// Builds ONE stylesheet with every rule, all gated by <html> attributes.
// Toggling a feature = flipping one attribute → a single style recalc, no DOM walking,
// and rules keep applying to nodes YouTube inserts later (infinite scroll, SPA nav)
// for free, which is exactly what a MutationObserver approach has to fake by hand.
//
// One rule PER SELECTOR, not one comma-joined rule per feature: a single selector
// the engine can't parse invalidates its whole rule, so one bad hook would
// silently kill every other selector of that feature.
export function buildStylesheet() {
  return FEATURES.filter((f) => f.hide)
    .flatMap((f) => f.hide.map((s) => `html[${attrFor(f.id)}] ${s} { display: none !important; }`))
    .concat(`html[${ON_ATTR}] [data-bft-filtered] { display: none !important; }`)
    .concat(`html[${attrFor('limit-suggestions')}] #related [data-bft-suggestion-overflow] { display: none !important; }`)
    .concat(`html[${attrFor('limit-suggestions')}] #related :is(ytd-continuation-item-renderer, yt-spinner, #spinner) { display: none !important; }`)
    .concat(HOVER_RULES.map((r) => `html[${attrFor('disable-hover-effects')}] ${r}`))
    .concat(`html[${attrFor('minimal-share')}] ytd-watch-metadata .bft-share-button { font-size: 0 !important; min-width: 40px !important; padding-inline: 10px !important; }`)
    .concat(`html[${attrFor('minimal-share')}] ytd-watch-metadata .bft-share-button :is(.ytSpecButtonShapeNextButtonTextContent, yt-formatted-string) { display: none !important; }`)
    .concat(`html[${attrFor('title-alignment')}="center"] ytd-watch-metadata #title { text-align: center !important; }`)
    .concat(`html[${attrFor('title-alignment')}="right"] ytd-watch-metadata #title { text-align: right !important; }`)
    .concat(`html[${attrFor('channel-alignment')}="center"] ytd-watch-metadata #top-row { display: grid !important; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) !important; align-items: center !important; margin-top: 12px !important; }`)
    .concat(`html[${attrFor('channel-alignment')}="center"] ytd-watch-metadata #owner { grid-column: 2 !important; justify-self: center !important; width: max-content !important; flex: none !important; margin: 0 !important; }`)
    .concat(`html[${attrFor('channel-alignment')}="center"] ytd-watch-metadata #actions { grid-column: 3 !important; justify-self: end !important; }`)
    .concat(`html[${attrFor('channel-alignment')}="right"] ytd-watch-metadata #owner { display: flex !important; flex: 1 1 0 !important; justify-content: flex-end !important; }`)
    .concat(`html[${ON_ATTR}] { overflow-y: auto !important; scrollbar-gutter: auto !important; }`)
    .concat(`html[${ON_ATTR}] body { overflow-y: auto !important; scrollbar-gutter: auto !important; }`)
    .concat(`html[${ON_ATTR}][data-bft-no-scroll] { overflow-y: hidden !important; }`)
    .concat(`html[${ON_ATTR}][data-bft-no-scroll] body { overflow-y: hidden !important; }`)
    .join('\n');
}

// The user's own rules + raw CSS, as a separate stylesheet so a syntax error in
// hand-written CSS can't touch the built-in rules. Rules go one-per-selector for
// the same reason as above.
export function buildCustomStylesheet(custom, { cssEnabled, enabled = true }) {
  if (!enabled) return '';
  const rules = custom.rules
    .filter((r) => r.enabled && isSafeSelector(r.selector))
    // :is() wrapper: a user selector like `a, b` spliced raw would gate only `a`
    // (`html[on] a, b`), leaving `b` hidden even with the master switch off.
    .map((r) => `html[${ON_ATTR}] :is(${r.selector}) { display: none !important; }`);
  if (cssEnabled && custom.css.trim()) rules.push(custom.css);
  return rules.join('\n');
}
