# Live test checklist (v2)

The automated suite proves the plumbing against fixture pages. This checklist covers what it can't: whether **live YouTube** still uses these selectors. Run it logged in, with an English UI (some fallbacks are text-based).

**How to read results:** open the popup on each page. Badge numbers are live match counts. If something is clearly visible on the page but its toggle shows **0**, that selector is dead. Note the toggle name and the page.

## 1. Home (`youtube.com/`)
- [ ] No Shorts shelf in the grid, no Shorts entry in the left sidebar (expanded **and** collapsed)
- [ ] No chip bar ("All / Music / …") and no blank strip where it was
- [ ] No Premium/promo banners at the top
- [ ] Sidebar: no Explore section, no "More from YouTube", no footer link wall
- [ ] Navigation → **Hide Subscriptions section** hides its heading, channel rows and Show more; switch it off and they return while Home stays visible
- [ ] Pick **Report history** → first candidate says **1 match**; Hide removes that row while Home, Help and subscribed channels remain
- [ ] **You sidebar** → toggle each heading/entry independently; restore each one and check that subscribed channels and page content stay visible
- [ ] **Hide Show less** leaves Show more available when the personal list is collapsed
- [ ] Masthead: voice-search mic gone
- [ ] Toggle **Hide Mixes** on → Mix tiles disappear
- [ ] Toggle **Hide community posts** on → post cards disappear (if your feed has any)
- [ ] Toggle **Hide watched** on → tiles with a nearly-full red bar disappear
- [ ] Master switch off → everything comes back instantly, no reload

## 2. Search (search anything popular)
- [ ] No Shorts shelf and no individual Shorts results
- [ ] Toggle **Hide live** / **Hide upcoming** → matching results vanish

## 3. Watch page
- [ ] Autoplay switch (player bottom-right) is **off** when the video opens
- [ ] Set **Default quality** to 1080p → the gear menu shows 1080p after any pre-roll ad ends
- [ ] Change quality in the popup while the video plays → it switches without a reload
- [ ] Toggle **Theater by default** → the next video opens in theater; exit it, flip any other toggle, and it stays exited
- [ ] No hashtags above the title
- [ ] Gear → Quality: no "Premium" entries
- [ ] Let a video reach the end → no end-screen card overlays / video wall
- [ ] Toggle **Hide comments** / **Hide related** → the sections vanish (playlist panel stays if you're in a playlist)

## 4. Shorts redirect
- [ ] Turn **Hide Shorts** off temporarily, click a Short → it opens in the normal `/watch?v=` player
- [ ] Paste a `youtube.com/shorts/<id>` URL → it lands on `/watch?v=<id>`; pressing Back doesn't bounce you into the Short

## 5. Blocklist
- [ ] Right-click a video thumbnail → **Block this channel** → toast appears, tile vanishes
- [ ] Options page → the channel shows up in "Blocked channels" (without a reload)
- [ ] Add a keyword that matches a visible title → Save → the tile vanishes in the open YouTube tab
- [ ] Scroll the feed → newly loaded matching tiles are hidden too
- [ ] On a watch page, right-click the channel name under the player → Block → the sidebar videos from that channel vanish
- [ ] Popup → **Apply blocklist** off → blocked tiles return instantly

## 6. Backup
- [ ] Options → Export → a JSON file downloads
- [ ] Change some toggles, Import that file → the toggles revert to the exported state

## 7. Filters (v2)
- [ ] Popup → Filters → **Hide shorter than** 2 → sub-2-minute videos vanish from home/search; set back to empty → they return without a reload
- [ ] **Hide fewer views than** 1000 → low-view videos vanish (search for something obscure)
- [ ] **Hide older than** 30 → older uploads vanish
- [ ] Options → Allowlist: add 2–3 channels → popup **Allowlist mode** on → only those channels remain in feeds
- [ ] **Home → Subscriptions** on → clicking the logo or opening youtube.com lands on Subscriptions

## 8. Power-user (v2)
- [ ] Popup → Custom → **Pick element to hide** (or Alt+Shift+H) → hover highlights components, click opens the panel; clicking did NOT open a video
- [ ] Switch between candidate selectors → preview highlights + match counts update; **↑ Parent** climbs to the enclosing component
- [ ] **Hide** → toast, element gone, the rule appears in the popup's Custom group with a match badge; toggling it brings the element back
- [ ] Options → Custom CSS: add something visible, Ctrl+S → applies live; popup **Apply custom CSS** off → reverts

## 9. Playback & presets (v2)
- [ ] **Default speed** 1.5× → new videos start at 1.5 and YouTube's own speed menu agrees
- [ ] **Remember speed per channel** on → set 2× on a channel's video → open another video from the same channel → starts at 2×; a different channel uses the default
- [ ] Options → Remembered speeds lists the channel; **Forget** removes it
- [ ] Preset chips: **Focus** hides comments/related/etc.; change a toggle → no chip highlighted, **+ Save** appears → save → your preset chip is highlighted
- [ ] Alt+Shift+P cycles presets (toast shows the name); Alt+Shift+Y toggles the extension. If a shortcut does nothing, check `chrome://extensions/shortcuts`: Chrome silently drops defaults that clash with other extensions

## 10. Online (opt-in, v2)
- [ ] Enable **SponsorBlock** → browser asks for access to sponsor.ajay.app; **Deny** → the setting flips back off
- [ ] Enable again, **Allow** → on a sponsored video (popular tech channels), playback jumps over the sponsor read with a "Skipped sponsor" toast
- [ ] Enable **Show dislike count** → grant → a number appears next to the dislike button; navigate to another video → it updates
- [ ] Revoke the permission in `chrome://extensions` → the popup's Online group shows "Access not granted" with a **Grant** button

## Report format

For anything that fails: **toggle name · page URL · what's still visible · popup badge number**. A DevTools screenshot of the element's tag/attributes speeds up the fix.


## Regression checks after the review fixes

Run `npm test` for logic and DOM regression coverage, then build and run the Chromium suite. A browser-launch failure is a setup failure, not a passing or failing behavioral result.

- Import malformed selectors with unmatched parentheses: they are dropped. Master off removes custom CSS and rules.
- Disable SponsorBlock while a delayed request is in flight; seek into a former segment: no skip. Repeat with category changes and A → B → A navigation.
- Enable an online feature and grant permission: it works on the current video. Revoke permission: status changes and old output/segments clear.
- Already-disabled autoplay must not delay theater. Disable a pending autoplay/theater action before its control appears: no late click.
- Enable speed memory during a video, use a speed key or the player's speed menu, then navigate between channels. Preview video rates and extension-applied defaults must not create overrides.
- Change a recycled tile's existing text node, title, and channel href independently: filtering updates. Paused filtering should perform no tile reads.
- Concurrently change separate settings and add separate channels from two contexts: both changes persist. Simulate a storage error: drafts remain and an error is shown.
- Ctrl/Meta/Shift-click Home: normal browser new-tab/window behavior is preserved.
- Search and Enabled only filter the popup; turn Selector diagnostics on to see match counts.
- Block a channel and use Undo. Reveal blocked/filtered tiles: orange outlines appear for 15 seconds and the grid keeps its layout (no tiles collapsing inline), then hiding resumes.
- Allowlist mode on a channel's Videos tab and in playlists: tiles stay visible (no channel row means no channel info, not "12K views"). Right-click Block on such a tile reports no channel.
- Speed memory on a hard-loaded watch page: the remembered entry in Options is a `UC…` channel id (linked), never an `@handle`, and the speed doesn't flicker on load.
- With the extension on, open the Share dialog, Save-to-playlist dialog and (narrow window) the guide drawer on Home and Watch: the page behind must not scroll.
- Toggle the master switch off and on mid-video after re-enabling autoplay: autoplay stays on until the next video.
- Hide Share button alone leaves Ctrl+C native; *Ctrl+C copies video link* enables the shortcut.
- Limit suggestions with a blocklist that hides some sidebar tiles: the visible count still matches the limit.
- Like/dislike a video with *Show dislike count* on: the count stays on the button.
- Trigger several toasts quickly (block + undo, SponsorBlock skip): they stack instead of overlapping.
- Options → rules: `ytd-a, ytd-b` is accepted; a broken selector reports a parse error.
- Navigate the picker with keyboard only. Saving failure keeps the panel open; Escape restores focus.
- Export/import speeds, confirm the replacement preview, and reset everything: speeds are included. Canceling import changes nothing; unrelated JSON is rejected.
- Test unsupported UI languages: view/age limitations are stated and unparseable tiles remain visible.
