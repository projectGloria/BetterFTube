# BetterFTube

Declutter YouTube with toggles. Manifest V3, Chromium + Firefox, no tracking, no remote config. **Zero network requests by default.** The two online features are opt-in and ask for permission to exactly one API origin each.

## Features (v2)

| Group | Toggles |
|---|---|
| **Feed** | Hide Shorts (everywhere) · Open Shorts in the normal player · Home → Subscriptions · Hide category chips · Keyword/channel **blocklist** · Hide watched (≥90%) · Mixes · Live · Upcoming · Members-only · Community posts · Playables · Promos & banners |
| **Filters** | Hide shorter than / longer than N min · fewer than N views · older than N days · **Allowlist mode** (only show channels you list) |
| **Watch page** | Subscription bell · Like/dislike · Share icon copies a short `youtu.be` link · Hide Share with Ctrl+C copying the link and confirmation toast · Save button · Three-dot menu · Description · Independent title and channel alignment · Comments · Related videos · Limit right-panel suggestions · End-screen cards · Info cards & watermark · Merch/products/donations · Hashtags above title · Live chat |
| **Player** | Disable autoplay-next · Theater by default · Default quality · Hide Premium-only qualities · **Default speed** · **Remember speed per channel** |
| **Navigation** | Explore section · More from YouTube · Sidebar footer · Notifications bell · Create button · Voice search |
| **Custom** | Your own CSS · your own hide rules (each one a toggle) |
| **Online (opt-in)** | **SponsorBlock** auto-skip (pick categories) · **Return YouTube Dislike** count |

Plus:
- **Presets:** Default and Focus are built in, and you can save your own from the popup. Cycle through them with **Alt+Shift+P**.
- **Element picker** (popup → Custom → Pick element, or **Alt+Shift+H**): click anything on YouTube, choose how broad the selector is (each option shows a live match count), and it becomes a toggle.
- **Right-click → "Block this channel"** on a video tile or channel row. Blocking and the picker offer Undo. The popup can reveal blocklist/filter matches for 15 seconds.
- **Alt+Shift+Y** turns the whole extension on/off.
- **Options page:** blocklist, allowlist, custom rules, custom CSS, presets, remembered speeds, and JSON import/export. Backups include speeds; older backups without them preserve existing speeds. Import previews explain replacement and normalization before saving.
- **Selector diagnostics** are optional in the popup. Counts refresh while it is open; zero can mean no matching content, not necessarily a broken selector. Search and Enabled only make controls easier to find.

## Privacy

- **Online features are off by default.** YouTube access comes from the declared content scripts; third-party API access is optional. Enabling SponsorBlock or the dislike count triggers a browser permission prompt for that one origin only (`sponsor.ajay.app` / `returnyoutubedislikeapi.com`), and you can revoke it any time in `chrome://extensions`.
- **SponsorBlock uses the hash-prefix API.** Only the first 4 hex chars of `sha256(videoId)` are sent, and the full video ID is not sent to SponsorBlock. A short prefix reduces disclosure but does not guarantee anonymity. The dislike API does receive the video id; that's inherent to how it works.
- All requests go through the background worker, which re-validates every message (video id format, category allowlist) and refuses if the permission isn't actually granted.

## Install

### Ungoogled Chromium / Chrome / Brave / Edge
```sh
npm install
npm run build
```
Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `.output/chrome-mv3`.
After pulling changes, run `npm run build` again and hit the reload icon on the extension card.

### Firefox (128+, Developer Edition recommended)
```sh
npm run build:firefox      # → .output/firefox-mv3
npm run zip:firefox        # → .output/betterftube-2.0.0-firefox.zip
```
- **Temporary:** `about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.json`.
- **Permanent (Dev Edition / Nightly):** set `xpinstall.signatures.required = false` in `about:config`, then install the zip from `about:addons` → gear → Install Add-on From File.

## Develop

```sh
npm run dev            # Chromium with the extension + HMR for popup/options
npm run dev:firefox
npm test               # pure logic + DOM regression tests
npm run test:e2e       # e2e in real Chromium; needs `npm run build` first
                       # first time on a machine: npx playwright install chromium
```

## Architecture

```
lib/features.js     toggle list: single source of truth (ids, labels, selectors, types, origins)
lib/settings.js     storage.local + normalize() (defaults, validation, import sanitizing = trust boundary)
lib/presets.js      built-in presets, active detection, cycling
lib/blocklist.js    pure matcher (keywords, /regex/, @handles, names)
lib/filters.js      pure parsers + predicate (duration, views, age, allowlist)
lib/behaviors.js    isolated-world JS: redirects, autonav, theater, tile scanner, speed memory, diagnostics
lib/picker.js       element picker (shadow-DOM UI, selector candidates)
lib/online.js       SponsorBlock skipping + dislike display (content side, no fetch)
lib/api.js          SponsorBlock / RYD fetchers (background only)
lib/speeds.js       per-channel speed store (own storage key)
lib/dom.js          world-agnostic DOM helpers (attr reads, waitFor, SPA nav hook)
entrypoints/
  youtube.content.js        isolated world: CSS injection, settings → <html> attrs, messaging
  youtube-main.content.js   MAIN world: quality + speed via YouTube's player API
  background.js             context menu, keyboard commands, network requests
  popup/  options/          React UIs
ui/                 shared React pieces (useSettings store, controls, diagnostics/permission hooks)
tests/              unit + e2e (fixtures mimic YouTube's DOM)
```

- **CSS first.** One stylesheet is injected at `document_start`, with every rule gated by an `<html data-bft-*>` attribute. A toggle flips one attribute; the browser's style engine does the rest. CSS-only toggles need no tile scanning, and content loaded later (infinite scroll, SPA nav) is covered automatically.
- **HTML attributes drive presentation and playback.** Online features use isolated settings state, and background requests independently check stored feature settings, the master switch, and API permission. Page-owned attributes cannot authorize network calls.
- **One rule per selector.** In CSS, one unparseable selector kills its whole rule. Splitting the rules means one dead hook can't take down a whole toggle.
- **The blocklist and filters mark tiles and CSS hides them.** One scanner pass, two attributes (`data-bft-blocked`, `data-bft-filtered`), each gated separately. The scanner caches a per-tile content signature (not just "seen this node"), because YouTube recycles tile elements for new videos.
- **Reduced flash on repeat visits.** Built-in attributes are mirrored into YouTube localStorage. The first visit, blocklists and custom styles still wait for settings. The mirror is not an authority for online features.
- **User rules are gated as a whole with `:is()`.** Spliced raw, `a, b` would gate only `a`. Imported selectors are parsed as complete selector lists, bounded in length, and rejected if malformed or containing raw parser nodes. Disabling the master switch removes the entire custom stylesheet. Raw CSS remains an explicit, separate import capability and can load external resources subject to page policy.
- **Speed memory records main-player changes after speed keys or player menu input.** Extension-applied rates clear the recording gesture. Navigation clears channel identity; stable player channel IDs are preferred, and unresolved SPA identity is skipped rather than attributed to a stale owner row. A fixed 1× default is available.

## Adding a toggle

Add one object to `FEATURES` in `lib/features.js`. For CSS-only toggles, that's all. For JS behavior, leave out `hide` and add a handler in `lib/behaviors.js` that checks `isOn(id)`.

## When YouTube breaks something

1. Open the popup on the affected page. A **0** badge may mean its selector no longer matches; first confirm that this page contains the relevant content. A red **!** means the browser can't parse it.
2. In DevTools, find the nearest stable `ytd-*` / `yt-*` tag or attribute (`[overlay-style]`, `[is-shorts]`, `href` patterns).
3. Update the selector in `lib/features.js` and run `npm run build`. If the fixture DOM needs to reflect the new structure, update `tests/fixtures/` too.

## Reliability and limits

- Settings and speed changes are serialized through the background worker. Field changes and list/rule edits preserve unrelated concurrent changes. Imports are explicit replacements. Save failures remain visible; list drafts are kept on failure.
- Online status distinguishes Off, permission needed, Loading, Ready, no segments, and failures. Granting or revoking access refreshes the current video. Requests time out after 10 seconds and identical in-flight lookups are shared.
- View-count and age filters currently parse English text. Unreadable statistics stay visible. An empty allowlist disables allow filtering; tiles without channel identity remain visible. Lists accept channel IDs, handles, or exact display names.
- List limits: 2,000 entries per list, 512 characters per entry. Regexes use RE2JS (no catastrophic backtracking): at most 50 regexes and 4,096 total pattern characters. Unsupported expressions are shown in Options. Matching inspects the first 2,000 title characters.
- Custom limits: 500 rules, 2,048 characters per selector, 20 presets, 100,000 CSS characters. Backups larger than 2 MB are rejected before parsing. Invalid or truncated imported data is called out before replacement.
- The picker supports Up/Down then Enter, Tab between panel controls, and Escape to cancel; focus returns to the previous element. Save/error messages use live regions.
- The automated browser suite uses fixtures, not live YouTube. Validate selectors and player integration on the real site using TESTING.md after a release or YouTube redesign.
