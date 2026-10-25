# Review fixes — 2026-10-25

All twelve findings from REVIEW.md have corresponding source changes. The original review is preserved as a historical record.

| Finding | Change |
| --- | --- |
| Imported selectors bypassing master switch | Parse complete selector lists with CSS Tree, reject raw/malformed syntax, bound selector size, and remove custom styles entirely while paused. |
| Background ignoring feature settings | Every API request checks saved master/feature state and host permission. SponsorBlock categories come from saved settings. Online state is held in isolated memory rather than page attributes. |
| Late SponsorBlock responses | Generation tokens invalidate delayed responses after disable, category changes and navigation. Every skip rechecks current state/video and respects media duration. |
| Permission activation/revocation | Background permission events refresh open videos. Pending feature intent survives popup closure; a denied/failed prompt rolls back when the popup remains alive. Without a grant, background requests are refused and the popup displays permission-needed status. |
| Playback waiting/cancellation | Autoplay and theater run independently, with separate cancellation controllers. Already-disabled autoplay does not delay theater. Waits honor pre-aborted signals and remove listeners on completion. |
| Speed attribution | Enabling memory mid-video discovers the channel. Recording is limited to the main player after speed keys/menu input. Extension writes clear the gesture. Navigation clears identity; stable player channel IDs prevent stale owner-row attribution. |
| Concurrent writes/errors | One background queue serializes settings and speed writes. Changes merge individual fields, list entries, and rule fields. Imports explicitly replace state. Errors are visible and list drafts survive failed saves. |
| Scanner cost/missed changes | Observe text and relevant attribute changes, queue affected tiles, process bounded batches with time slicing, and disconnect when no effective filters are active. |
| Regex backtracking | RE2JS provides linear-time matching. Pattern count/length and title length are bounded; unsupported/over-limit patterns are reported. |
| Modified Home clicks | Ctrl/Meta/Shift/Alt clicks and explicit link targets preserve browser behavior. |
| Filter semantics | UI explains English-only view/age parsing, empty allowlists and missing-channel fallback. Channel IDs are supported alongside names/handles. |
| API robustness | Ten-second request timeout, in-flight deduplication, strict segment/count validation, finite boundaries, and nonnegative integer dislike counts. |

## Usability and maintenance

- Popup search, Enabled only, optional selector diagnostics, online status and filter-language information.
- Undo after blocking/picking; 15-second reveal of blocked/filtered tiles with orange outlines and counts by reason.
- Accessible editor labels, live save/error/toast messages, keyboard picker navigation, panel focus handling and focus restoration.
- Higher-contrast primary buttons, explicit keyboard focus indicators and reduced-motion support.
- Recognized-backup validation, a 2 MB import limit, replacement preview with normalization/custom-CSS disclosure, and awaited persistence before reporting success.
- Backups/reset now include remembered speeds. Older backups without speeds keep existing speed records.
- Visible capacity limits and errors for oversized list/CSS edits; duplicate preset IDs are normalized.
- Fixed 1× default speed; updated privacy, installation, architecture and testing documentation.
- Added `css-tree` and `re2js` runtime dependencies, plus `jsdom` for regression testing. No new API origins were added. The production output is approximately 1.22 MB, increased from approximately 313 KB by the parser and safe regex engine.

## Verification

- `npm test`: 33 passing tests (15 original plus 18 regression tests).
- Chromium production build: passed.
- Firefox production build: passed.
- Dependency audit: zero reported vulnerabilities.
- Browser fixture suite: blocked during setup by Windows `spawn UNKNOWN` launching Playwright Chromium. This is not a passing browser test result.
- Live YouTube, real native permission prompts, Firefox runtime, and visual/screen-reader verification still need the checklist in TESTING.md.

The new regression suite exercises real source in a simulated DOM and mocked extension APIs. It covers race handling and state changes, but cannot prove YouTube's current selectors or private player API behavior. On SPA layouts where the player does not expose a channel ID, speed memory conservatively waits for resolvable identity instead of assigning changes to a stale owner row. View/age parsing remains intentionally English-only, now explicitly disclosed in the UI.

Reload the unpacked extension and refresh existing YouTube tabs to load the updated content scripts. Build outputs are in `.output/chrome-mv3` and `.output/firefox-mv3`.
