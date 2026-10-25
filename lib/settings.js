// Settings persistence. storage.local, not sync: Ungoogled Chromium has no sync
// backend, and local has a far larger quota. JSON import/export covers portability.
import { browser } from 'wxt/browser';
import { FEATURES } from './features.js';
import { isSafeSelector, LIMITS } from './validation.js';
import { settingsChanges } from './mutations.js';
export { isSafeSelector } from './validation.js';

const KEY = 'bft:settings';
const SCHEMA = 1;
const MAX_LIST = 2000; // sanity cap: a pasted 50k-line list would make every scan crawl
const MAX_RULES = 500;
const MAX_PRESETS = 20;
const MAX_CSS = 100_000;

export const DEFAULT_FEATURES = Object.freeze(Object.fromEntries(FEATURES.map((f) => [f.id, f.default])));

export const DEFAULTS = Object.freeze({
  schema: SCHEMA,
  enabled: true, // master switch
  features: DEFAULT_FEATURES,
  lists: Object.freeze({ keywords: Object.freeze([]), channels: Object.freeze([]), allow: Object.freeze([]) }),
  custom: Object.freeze({ css: '', rules: Object.freeze([]) }),
  presets: Object.freeze([]), // user presets; built-ins live in lib/presets.js
});

// Trim, drop blanks, dedupe case-insensitively (first spelling wins), cap length.
export function cleanList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, LIMITS.entry);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

// Merge stored data over defaults, keyed by the CURRENT toggle list:
// - toggles added in an update pick up their default instead of being undefined
// - toggles removed from the list are dropped instead of lingering in storage
// - anything malformed (hand-edited import, old version) falls back to defaults
// Bump SCHEMA and migrate here if the shape ever changes incompatibly.
export function normalizeFeatures(raw) {
  const features = {};
  for (const f of FEATURES) {
    const v = raw?.[f.id];
    if (f.type === 'number') {
      // Clamp instead of reject: "9999 minutes" from a hand-edited file should
      // become the max, not silently turn the filter off.
      features[f.id] = Number.isFinite(v) ? Math.min(f.max, Math.max(0, v)) : f.default;
      continue;
    }
    const valid = f.type === 'select' ? f.options.some((o) => o.value === v) : typeof v === 'boolean';
    features[f.id] = valid ? v : f.default;
  }
  return features;
}

// A selector is spliced into a stylesheet as `html[...] SELECTOR { ... }`.
// Braces/semicolons would let it close the rule and inject arbitrary CSS, which
// matters once people swap preset/rule files. Real selectors never need them.


function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  const ids = new Set();
  for (const r of rules) {
    if (!r || !isSafeSelector(r.selector)) continue;
    let id = typeof r.id === 'string' && r.id ? r.id : null;
    if (!id || ids.has(id)) id = newId(); // dedupe ids from merged/hand-edited files
    ids.add(id);
    out.push({
      id,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 80) : r.selector.trim().slice(0, 80),
      selector: r.selector.trim(),
      enabled: r.enabled !== false,
    });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

function normalizePresets(presets) {
  if (!Array.isArray(presets)) return [];
  const ids = new Set();
  return presets
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, MAX_PRESETS)
    .map((p) => {
      let id = typeof p.id === 'string' && p.id.startsWith('user:') && p.id.length <= 100 ? p.id : `user:${newId()}`;
      if (ids.has(id)) id = `user:${newId()}`;
      ids.add(id);
      return {
      id,
      name: p.name.trim().slice(0, 40),
      features: normalizeFeatures(p.features),
    }; });
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function normalize(raw) {
  return {
    schema: SCHEMA,
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
    features: normalizeFeatures(raw?.features),
    lists: {
      keywords: cleanList(raw?.lists?.keywords),
      channels: cleanList(raw?.lists?.channels),
      allow: cleanList(raw?.lists?.allow),
    },
    custom: {
      css: typeof raw?.custom?.css === 'string' ? raw.custom.css.slice(0, MAX_CSS) : '',
      rules: normalizeRules(raw?.custom?.rules),
    },
    presets: normalizePresets(raw?.presets),
  };
}

export async function loadSettings() {
  const { [KEY]: raw } = await browser.storage.local.get(KEY);
  return normalize(raw);
}

export function saveSettings(settings) {
  return browser.storage.local.set({ [KEY]: normalize(settings) });
}

// Every writer goes through the background's single queue.
export async function commitSettings(message) {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Could not save settings');
  return response.settings;
}

export async function updateSettings(fn) {
  const before = await loadSettings();
  const after = normalize(fn(before));
  return commitSettings({ type: 'bft:settings-change', changes: settingsChanges(before, after) });
}

export function replaceSettings(settings, speeds) {
  return commitSettings({ type: 'bft:settings-replace', settings: normalize(settings), ...(speeds === undefined ? {} : { speeds }) });
}

// storage.onChanged fires in EVERY extension context (popup, all content scripts),
// which is what makes toggles apply live across all open YouTube tabs.
// Returns an unsubscribe function so React effects / stores can clean up.
export function onSettingsChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'local' && KEY in changes) cb(normalize(changes[KEY].newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
