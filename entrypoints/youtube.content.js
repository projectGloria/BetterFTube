import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  blockTargetChannel,
  diagnose,
  runBehaviorsNow,
  setLists,
  startBehaviors,
  toast,
} from '../lib/behaviors.js';
import { FEATURES, ON_ATTR, attrFor, attrValue, buildCustomStylesheet, buildStylesheet } from '../lib/features.js';
import { startOnline, onlineStatus } from '../lib/online.js';
import { startPicker } from '../lib/picker.js';
import { isSafeSelector, loadSettings, newId, onSettingsChanged, updateSettings } from '../lib/settings.js';

// Sync mirror of our <html> attrs in youtube.com's localStorage. storage.local
// is async, so on a cold load there's a window where nothing is hidden yet;
// reading this synchronously at document_start closes it. It's a cache only:
// the real settings always win once they arrive.
const MIRROR_KEY = 'bft:attrs';

const MANAGED = [ON_ATTR, ...FEATURES.map((f) => attrFor(f.id))];

export default defineContentScript({
  // Desktop site only. music.youtube.com / m.youtube.com have different DOMs.
  matches: ['*://www.youtube.com/*'],
  // document_start = before YouTube's JS renders anything, so the stylesheet is
  // in place before the first Shorts shelf can paint (no flash-then-vanish).
  runAt: 'document_start',

  main() {
    const root = document.documentElement;

    const setAttrs = (attrs) => {
      for (const name of MANAGED) {
        const value = attrs[name] ?? null;
        // Skip no-op writes: each setAttribute fires MutationObservers watching
        // <html> (ours in MAIN world included), even when the value is unchanged.
        if (root.getAttribute(name) === value) continue;
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    };

    try {
      setAttrs(JSON.parse(localStorage.getItem(MIRROR_KEY)) ?? {});
    } catch {} // blocked storage / corrupt value: just skip the head start

    // At document_start <head> may not exist yet; appending to <html> is valid and
    // survives YouTube's SPA navigations because the document is never replaced.
    const style = document.createElement('style');
    style.id = 'betterftube';
    style.textContent = buildStylesheet();
    // User rules + raw CSS in their own sheet: a syntax error in hand-written CSS
    // can't break the built-in rules.
    const customStyle = document.createElement('style');
    customStyle.id = 'betterftube-custom';
    (document.head ?? root).append(style, customStyle);

    // Settings → <html> attributes. This is the ONLY place settings are read in
    // the page; CSS, behaviors and the MAIN-world script all key off the attrs.
    // Lists and custom rules are the exception (too big for attributes).
    let lastLists = '';
    let lastCustom = '';
    let rules = [];
    let initialApplied = false;
    const apply = (settings) => {
      const attrs = {};
      if (settings.enabled) {
        attrs[ON_ATTR] = '';
        for (const f of FEATURES) {
          const v = attrValue(f, settings.features[f.id]);
          if (v !== null) attrs[attrFor(f.id)] = v;
        }
      }
      setAttrs(attrs);
      try {
        localStorage.setItem(MIRROR_KEY, JSON.stringify(attrs));
      } catch {}

      // Only rebuild when inputs actually changed, not on every toggle flip: a
      // matcher rebuild invalidates every cached tile verdict and forces a rescan.
      const lists = JSON.stringify(settings.lists);
      if (lists !== lastLists) {
        lastLists = lists;
        setLists(settings.lists);
      }
      const css = buildCustomStylesheet(settings.custom, {
        enabled: settings.enabled,
        cssEnabled: settings.enabled && settings.features['custom-css'],
      });
      if (css !== lastCustom) customStyle.textContent = lastCustom = css;
      rules = settings.custom.rules;
      refreshOnline(settings);
      if (!initialApplied) { initialApplied = true; runBehaviorsNow(); }
    };

    startBehaviors();
    const refreshOnline = startOnline({ onSkip: (s) => toast(`Skipped ${s.category}`) });

    let changed = false;
    loadSettings().then((s) => {
      if (changed) return;
      apply(s);
    }).catch(err => toast(`Could not load settings: ${err.message}`));
    onSettingsChanged(s => { changed = true; apply(s); });

    const addRule = async ({ selector, label }) => {
      if (!isSafeSelector(selector)) throw new Error('This selector is unsupported. Choose another candidate.');
      const id = newId();
      await updateSettings(s => {
        if (s.custom.rules.length >= 500) throw new Error('Rule limit reached (500)');
        return { ...s, custom: { ...s.custom, rules: [...s.custom.rules, { id, label, selector, enabled: true }] } };
      });
      toast(`BetterFTube: hiding "${label}"`, () => updateSettings(s => ({ ...s,
        custom: { ...s.custom, rules: s.custom.rules.filter(r => r.id !== id) } })));
    };
    let revealTimer;
    const revealStyle = document.createElement('style');
    (document.head ?? root).append(revealStyle);

    // Messages from popup (diagnostics, picker) and background (context menu,
    // shortcuts). sendResponse + `return true` instead of returning a Promise:
    // promise returns from onMessage aren't supported in every Chromium build yet.
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'bft:online-refresh':
          refreshOnline(undefined, true);
          return false;
        case 'bft:reveal':
          clearTimeout(revealTimer);
          revealStyle.textContent = 'html[data-bft-on] [data-bft-blocked], html[data-bft-on] [data-bft-filtered] { display: revert !important; outline: 2px solid orange !important; }';
          toast('Revealed blocked and filtered tiles for 15 seconds. Orange outlines mark them.');
          revealTimer = setTimeout(() => { revealStyle.textContent = ''; }, 15000);
          sendResponse({ ok: true });
          return false;
        case 'bft:diagnose':
          sendResponse({ ...diagnose(FEATURES, rules, { selectors: msg.selectors !== false }), online: onlineStatus() });
          return false;
        case 'bft:pick':
          startPicker({ onSave: addRule });
          sendResponse({ ok: true });
          return false;
        case 'bft:toast':
          if (typeof msg.text === 'string') toast(msg.text);
          return false;
        case 'bft:block-channel': {
          const entry = blockTargetChannel();
          if (!entry) {
            toast('BetterFTube: no channel found under the cursor');
            sendResponse({ ok: false });
            return false;
          }
          let added = false;
          updateSettings(s => {
            added = !s.lists.channels.some(c => c.toLowerCase() === entry.toLowerCase());
            if (added && s.lists.channels.length >= 2000) throw new Error('Channel limit reached (2000)');
            return { ...s, lists: { ...s.lists, channels: [...s.lists.channels, entry] } };
          }).then(() => {
            toast(`BetterFTube: blocked ${entry}`, added ? () => updateSettings(s => ({ ...s,
              lists: { ...s.lists, channels: s.lists.channels.filter(c => c.toLowerCase() !== entry.toLowerCase()) } })) : undefined);
            sendResponse({ ok: true, entry });
          }).catch(err => { toast(`Could not block channel: ${err.message}`); sendResponse({ ok: false }); });
          return true; // keep the channel open for the async response
        }
        default:
          return false;
      }
    });
  },
});
