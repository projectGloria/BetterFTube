// World-agnostic helpers: no `browser.*` imports, so this file is safe to bundle
// into the MAIN-world script too (which has no extension API access at all).
import { attrFor } from './features.js';

const root = document.documentElement;

// The <html> attributes ARE the runtime state. Behaviors read them on demand
// instead of capturing settings in closures, so they can never act on stale values.
export const isOn = (id) => root.hasAttribute(attrFor(id));
export const valueOf = (id) => root.getAttribute(attrFor(id));

// Fires when the given features' attributes change (settings flip, master switch).
export function onAttrChange(ids, cb) {
  const mo = new MutationObserver(cb);
  mo.observe(root, { attributes: true, attributeFilter: ids.map(attrFor) });
  return () => mo.disconnect();
}

// Resolve with the first element matching `selector`, or null after `timeout`.
// Player controls render lazily after navigation, hence the observer.
// Always disconnects: an orphaned subtree observer on YouTube's DOM means
// a callback on every one of thousands of mutations per second, forever.
export function waitFor(selector, { timeout = 10_000, signal, attributes = false } = {}) {
  if (signal?.aborted) return Promise.resolve(null);
  const hit = document.querySelector(selector);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    let finished = false;
    const abort = () => done(null);
    const done = (el) => {
      if (finished) return;
      finished = true;
      mo.disconnect();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(signal?.aborted ? null : el);
    };
    const mo = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) done(el);
    });
    const timer = setTimeout(() => done(null), timeout);
    mo.observe(document, { childList: true, subtree: true, attributes });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

// YouTube is a SPA: page changes fire `yt-navigate-finish` on document, never a
// real load. This is the hook for "on every page" behavior.
export function onNavigate(cb) {
  document.addEventListener('yt-navigate-finish', cb);
  return () => document.removeEventListener('yt-navigate-finish', cb);
}
