# BetterFTube review — 2026-10-25

> Implementation update: all twelve findings below have been addressed in the working source. See FIXES.md for the changes, validation and remaining live-browser verification. The findings are retained as the original review record; line references describe the original source.

## Assessment

The feature registry, generated CSS, pure filtering helpers, isolated player bridge, and local storage design are a sound foundation. Keep this architecture. The largest improvements should address settings authority, cancellation, persistence, and regression coverage before adding more toggles.

This was a source review of the extension, both UIs, build configuration, fixtures, and tests. No production source was changed. The original diagnostic scripts have now been replaced by regression tests in tests/regression.test.js.

## Verification and limits

| Check | Result |
| --- | --- |
| `npm test` | All 15 tests passed |
| `npm run build` | Chromium build succeeded |
| `npm run build:firefox` | Firefox build succeeded; runtime compatibility not tested |
| `npm audit --json` | Zero reported vulnerabilities; this does not establish overall security |
| `node tests/review-logic.mjs` | Reproduced four logic defects described below |
| `npm run test:e2e` | Blocked in suite setup: missing Chromium initially; after installation, Windows returned `spawn UNKNOWN` |
| `node tests/review-probes.mjs` | Same browser launch failure; browser reproductions remain unverified |
| Live YouTube / visual / accessibility testing | Not performed |

The 20 browser tests reported failures because their shared setup failed. This is not evidence that all 20 extension behaviors are broken. The tests use synthetic YouTube pages and a mocked player; even a fully passing run would not establish that selectors and player APIs still work on live YouTube.

## Findings in priority order

### 1. P1 — Imported selectors can escape the master-switch gate

Location: `lib/settings.js:65`, `lib/features.js:525`.

`isSafeSelector()` rejects braces, semicolons, and comments, but does not require balanced selector syntax. An imported rule containing `div), body, :is(div` survives normalization and generates:

```css
html[data-bft-on] :is(div), body, :is(div) { display: none !important; }
```

The `body` selector is unconditional. The rule can therefore blank YouTube even when the master switch is off. The interactive rule editor's syntax check does not protect JSON imports. This is a CSS containment defect, not JavaScript execution.

Evidence: the logic probe confirms acceptance and prints this exact stylesheet. Rendering it in Chromium remains blocked by the browser launch issue.

Fix: validate imported selectors with a real selector parser, and reject anything that cannot be parsed as a complete selector list. At stylesheet construction, also avoid emitting any custom hide rules while the master switch is off. Keep this safeguard separate from raw custom CSS, which is intentionally user-authored code.

Acceptance: malformed parentheses, escaped tokens, comma lists, and nested `:is()`/`:has()` cases cannot create an ungated selector; disabling the master switch removes all custom hiding.

### 2. P1 — Background network authorization ignores actual settings

Location: `entrypoints/background.js:64–86`, `lib/online.js:88–89`.

The background handler validates sender identity, the URL, video IDs, categories, and host permission. It does not read `settings.enabled`, the online feature setting, or the user's selected SponsorBlock categories.

Online behavior is triggered through page-owned HTML attributes. A script running on YouTube can set `data-bft-dislikes` and cause the content script to send a valid extension message. Once the user has previously granted API access, the background will honor it even when the feature or extension is disabled. This does not bypass a missing host permission.

Evidence: the logic probe supplies disabled settings and an existing grant; the background still invokes the dislike fetcher. The full page-attribute reproduction is included in the browser probes but was not executed successfully.

Fix: check normalized extension settings in the background on every request, derive allowed categories from those settings, and treat the DOM mirror only as a rendering mechanism. Keep online feature state in isolated-world memory rather than accepting page attributes as authority.

Acceptance: requests with a valid sender and grant still fail when the master switch or feature is off; page attribute changes cannot broaden categories or enable online features.

Browser model reference: [Chrome content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) confirms that isolated scripts and page scripts share the DOM.

### 3. P1 — A late SponsorBlock response re-enables skipping after disable

Location: `lib/online.js:16–47`.

Turning SponsorBlock off clears segments but leaves `segmentsFor` equal to the current video ID. A request started before disabling can resolve afterward, pass the video-ID-only guard, and restore segments. `onTimeUpdate()` does not recheck the enabled setting. Changing category choices can similarly accept an older response for the same video.

Evidence: the logic probe starts a request, disables the feature, resolves the request, and seeks to 2 seconds. Playback jumps to 4 seconds while enabled is false.

Fix: increment a request generation on every refresh, including disable; accept only the latest generation. Recheck enabled state and current video before each skip. Reset state at navigation start as well as after navigation completes.

Acceptance: disable during a delayed request, rapid category changes, and A → B → A navigation never apply obsolete segments.

### 4. P2 — Granting online access may leave the current video inactive

Location: `entrypoints/popup/App.jsx:69–81,199`, `ui/usePermissions.js`, `lib/online.js:80–91`.

The popup persists the feature before awaiting the permission prompt. The content script can immediately request data, which the background correctly refuses before the grant. When permission is granted, only the popup's permission display refreshes; neither settings nor the content script necessarily receives a refresh. The separate Grant button also lacks a retry signal.

Fix: persist activation after a successful grant, retaining user-gesture requirements for the request itself, and send an explicit online-state refresh from background permission listeners. Handle revocation too. Surface permission/request errors instead of silently swallowing them.

Acceptance: enabling and granting works on the currently open video without navigation; granting after denial retries; revocation removes or deactivates online behavior as intended.

### 5. P2 — Autoplay waiting delays theater mode and cancellation is incomplete

Location: `lib/behaviors.js:49–70`, `lib/dom.js:23–40`.

Theater mode runs after waiting for an autoplay control whose `aria-checked` is true. If autoplay is already off, that wait expires after ten seconds before theater mode runs. The wait observes child additions/removals, not an existing control's `aria-checked` changes.

`waitFor()` also returns an existing element even if its signal is already aborted, and an already-aborted signal with no matching element creates a new observer until timeout. Autoplay/theater actions do not consistently recheck cancellation and enabled state after awaiting. Switching a feature off during a pending wait can therefore still cause a click later.

Evidence: the logic probe confirms that an already-aborted wait returns an element. Theater delay and late-click consequences are established by source flow; browser probes remain pending.

Fix: run independent behaviors concurrently; wait for the autoplay control regardless of checked state, then inspect it; honor cancellation before query and after each await; cancel pending behavior when its feature is disabled; remove abort listeners on completion.

Acceptance: theater activates promptly with autoplay already off; disabling or navigating during any wait causes no later click.

### 6. P2 — Speed memory has activation and attribution gaps

Location: `lib/behaviors.js:127–164`.

If remember-speed is disabled when a watch page loads, channel discovery returns early. Enabling it during that video only republishes the cache; it does not discover the channel. `currentChannel` stays null and speed changes are ignored until navigation.

The trusted-input heuristic is also broad: any trusted keyboard/pointer input within one second makes subsequent programmatic rate changes look user-initiated. A navigation click followed by the extension applying the default can accidentally record or erase a channel override. The listener accepts any video element on the watch page, including previews. A link that already exists in a recycled owner row is not proof it belongs to the new video.

Fix: rediscover the owner when enabling; bind owner resolution to navigation/video identity; restrict recording to the main player; track extension-initiated rate writes so their events cannot become user choices. Preserve a documented fallback for player controls that cannot be identified reliably.

Acceptance: enabling mid-video works, preview videos cannot update memory, and navigation/default restoration cannot overwrite remembered channel speeds.

### 7. P2 — Concurrent settings writes can lose changes; save errors are invisible

Location: `lib/settings.js:124–134`, `ui/useSettings.js:25–52`, `lib/speeds.js:14–20`.

Multiple contexts perform read-modify-write of entire objects. Two tabs adding channels, or an options edit overlapping a popup toggle, can read the same base and overwrite each other. Storage latency makes the collision window larger than the comment's suggestion of simultaneous human clicks. Speed writes have the same pattern.

The UI applies an optimistic snapshot and discards the persistence promise. Storage failure can leave the UI displaying an unsaved state; imports report success before persistence is confirmed. Incoming echoes of earlier saves can also replace newer optimistic snapshots while updates are pending.

Fix: serialize semantic mutations through one background writer, and acknowledge committed state. Support explicit actions such as setting one feature or adding one channel. Normalize before optimistic publication, track pending revisions, and show save failures. A queue in each UI alone will not solve cross-context writes.

Acceptance: interleaved changes from two contexts preserve both edits; failures do not report success or silently lose drafts.

### 8. P2 — Tile scanning misses some updates and keeps doing work when disabled

Location: `lib/behaviors.js:218–262`.

The scanner observes only `childList`. Changing an existing text node's data or a link/title attribute does not schedule a scan. The signature cache detects changed content only once a scan runs, so it cannot repair missing notifications.

Whenever blocklists are nonempty, a matcher remains active even when the blocklist or master switch is off. Every qualifying page mutation can schedule a full-document tile scan. The WeakMap skips repeated predicate execution but still reads every tile's title, channel, duration, and metadata before deciding its signature is unchanged.

Fix: observe relevant character/attribute updates with a narrow attribute filter; queue affected tile ancestors and newly added tiles; disconnect when no effective feature needs scanning. Avoid observing the extension's own marker attributes in a feedback loop. Measure large-feed behavior before choosing more elaborate scheduling.

Acceptance: title-only and href-only recycled tiles update; disabled features cause no ongoing scanner work; unrelated mutations do not read the whole feed.

### 9. P2 — User regexes can block the page's main thread

Location: `lib/blocklist.js:25,41`, `lib/settings.js:23–37`.

Regex validation checks syntax, not runtime cost. A valid expression such as `/^(a+)+$/` can have pathological backtracking against a long nonmatching title. It runs synchronously in the tile scanner, with up to 2,000 entries and no per-entry length cap. Imported lists make this more than a typo-only concern.

Fix: prefer substring matching by default. For advanced regex support, use a bounded/linear-time engine or a terminable worker with explicit resource limits. A syntax check or heuristic alone is not a guarantee. Cap entry and selector lengths and import file size before reading/parsing the whole file.

No pathological expression was executed during this review.

### 10. P2 — Modified Home clicks lose normal browser behavior

Location: `lib/behaviors.js:80–91`.

Unlike the Shorts handler, the Home handler does not ignore Ctrl, Meta, Shift, Alt, or non-primary clicks. Ctrl-clicking the logo is prevented and triggers navigation in the current tab instead of the requested new tab.

Fix: apply the same plain-primary-click guard as the Shorts handler; account for already-prevented events and explicit link targets.

### 11. P2 — Filter and allowlist semantics need visible limitations

Location: `lib/filters.js:21–38,63–79`, options allowlist help.

Views and age parse English strings only. Non-English YouTube silently retains videos instead of applying those thresholds. This conservative fallback is sensible but is not explained in the feature controls. Empty allowlists disable allow filtering; tiles lacking channel/handle also pass, despite help promising that every non-allowlisted video is hidden.

Fix: expose unsupported-language/missing-data status, define empty-allowlist behavior explicitly, and use stable channel IDs where available. Add locale-aware parsers or structured metadata only where a reliable extraction source exists. Channel names are mutable and nonunique; handles can change.

### 12. P3 — API parsing and request lifecycle need hardening

Location: `lib/api.js:12–57`.

Requests have no explicit timeout or in-flight deduplication. Duplicate startup/attribute/navigation refreshes can issue identical calls before the cache fills. Segment parsing assumes arrays/objects deeper in the response and validates finite starts but not finite numeric ends, nonnegative boundaries, category/UUID shape, or segment count. Negative dislike counts are accepted.

Fix: validate remote response shapes and numeric ranges, apply request timeouts, deduplicate pending requests, and expose distinct permission/network/no-data states. Clamp skip targets against usable media bounds where appropriate.

## Product and usability improvements

1. **Explain hidden content.** Show totals by reason, provide a temporary reveal action, and offer Undo after blocking a channel or adding a rule. A blank feed should tell the user whether filters caused it.
2. **Make online status explicit.** Distinguish Off, Needs permission, Loading, Ready, No segments/data, and Failed. Currently an enabled control can appear to do nothing.
3. **Add search and an Enabled-only view.** The feature set is large enough that scanning collapsible groups becomes work. Keep presets as the fast entry point.
4. **Move selector diagnostics into an optional advanced view.** Counts are match counts, not proof of correct behavior or numbers of hidden videos. They are fetched once when the popup opens, rather than continuously. A zero can simply mean no matching content exists on that page.
5. **Improve accessibility.** Associate the list textareas with their visible headings, label rule-name and rule-selector inputs, announce save/error/toast messages, and add keyboard selection/focus management to the picker. Its current selection flow depends on pointer hover/click. Validate focus and contrast in a real browser before claiming compliance.
6. **Make imports reviewable.** Require a recognized backup shape, show what will be replaced, report dropped/truncated values, and make raw custom CSS an explicit part of the preview. Currently an unrelated JSON object such as `{}` silently becomes defaults and replaces the configuration.
7. **Clarify backup/reset scope.** Speeds are excluded from export and reset while the button says Reset everything. Either include them or name the action more precisely. Expose preset/rule/list limits instead of silently discarding excess entries.
8. **Offer a fixed 1× default speed.** The existing YouTube/off option means leave the site's choice alone, which is different from always starting at normal speed.

## Documentation and maintenance

- Correct the Firefox zip example from version 1.0.0 to 2.0.0 or make it version-independent.
- Describe third-party API grants separately from YouTube site access; the extension does have statically declared YouTube content scripts.
- Qualify the SponsorBlock privacy claim: a four-character hash prefix reduces information sent; it is not a guarantee that the server cannot infer a video, particularly with small candidate sets or other information.
- State that optional raw CSS can include network-loading declarations subject to page policy. The importer preserves raw CSS by design, so its comment claiming a shared file cannot smuggle CSS is misleading.
- Qualify no-flash claims: the mirror contains built-in attributes, not custom CSS or list decisions, and the first visit may have no mirror.
- Preserve the single feature registry, but document that tile parsing and player integration can also need updates when YouTube changes; selectors are not the only maintenance surface.
- The supplied folder is not a Git repository. Version control would make fixes, release comparisons, and rollback easier.
- Firefox 128 MAIN-world support is consistent with [Mozilla's release explanation](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/). Successful compilation alone does not verify the rest of Firefox behavior or store acceptance.

## Suggested implementation sequence

**First: restore trustworthy switches and imports.** Fix findings 1–4. Add delayed-response, disabled-setting, permission-grant, and malformed-selector regression coverage.

**Second: stabilize playback and navigation.** Fix findings 5–6 and 10. Add realistic SPA fixtures with changing video IDs, delayed/reused owner rows, existing disabled autoplay controls, ads, and repeated visits to the same video. The current player fixture always reports the same ID.

**Third: protect user data and responsiveness.** Centralize writes, add visible persistence errors, make scanning incremental and inactive when disabled, and bound regex/import work.

**Fourth: improve everyday usability.** Add Undo/reveal, filter explanations, accessible labels/status, and settings search. Extend language coverage based on the user's actual YouTube language.

For each stage, run unit and Chromium fixture tests, then the relevant live checks in TESTING.md on both target browsers. Isolate test settings per case where practical; the existing browser suite shares state and relies on earlier tests, which can amplify unrelated failures. Test genuine permission grants separately from the current mock of `permissions.contains`.

## Regression coverage

Run `npm test` for the original unit tests and the new regression suite. The original diagnostic scripts were removed after their defect reproductions were converted into assertions of corrected behavior. `npm run test:e2e` remains the browser fixture suite.
