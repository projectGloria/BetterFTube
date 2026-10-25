// Presets = named snapshots of `features`. Lists, custom rules and the master
// switch are deliberately NOT part of a preset: switching to "Focus" shouldn't
// wipe a blocklist you spent an hour on.
import { FEATURES, isActiveValue } from './features.js';
import { DEFAULT_FEATURES, normalizeFeatures } from './settings.js';

// Built-ins are code, not data: they upgrade with the extension (new toggles get
// sensible values) and can't be deleted into a broken state.
export const BUILTIN_PRESETS = [
  { id: 'builtin:default', name: 'Default', features: DEFAULT_FEATURES },
  {
    id: 'builtin:focus',
    name: 'Focus',
    features: normalizeFeatures({
      ...DEFAULT_FEATURES,
      'hide-shorts': true,
      'hide-chips': true,
      'home-to-subs': true,
      'hide-mixes': true,
      'hide-posts': true,
      'hide-comments': true,
      'hide-related': true,
      'hide-live-chat': true,
      'hide-notifications': true,
      'disable-autonav': true,
    }),
  },
];

export const allPresets = (settings) => [...BUILTIN_PRESETS, ...settings.presets];

// Compare only "is it on, and with what value": two snapshots that differ only in
// features added after the preset was saved still normalize to the same values.
export function sameFeatures(a, b) {
  return FEATURES.every((f) => a[f.id] === b[f.id]);
}

export const activePreset = (settings) => allPresets(settings).find((p) => sameFeatures(p.features, settings.features)) ?? null;

// For the hotkey: next preset after the active one; from a custom (unsaved)
// state, start at the first.
export function nextPreset(settings) {
  const list = allPresets(settings);
  const cur = activePreset(settings);
  const i = cur ? list.findIndex((p) => p.id === cur.id) : -1;
  return list[(i + 1) % list.length];
}

export const applyPreset = (settings, preset) => ({ ...settings, features: normalizeFeatures(preset.features) });

export const countActive = (features) => FEATURES.filter((f) => isActiveValue(features[f.id])).length;
