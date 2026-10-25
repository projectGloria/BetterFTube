// Per-channel playback speeds. Separate storage key from settings on purpose:
// every settings write fans out to every tab's apply(); speed memory changes
// often and only matters on watch pages, so it gets its own channel.
import { browser } from 'wxt/browser';

const KEY = 'bft:speeds';
const MAX = 1000; // channels; oldest dropped first (insertion order)

export function normalizeSpeeds(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([channel, rate]) =>
    channel.length <= 512 && !['__proto__', 'constructor', 'prototype'].includes(channel) &&
    Number.isFinite(rate) && rate >= 0.25 && rate <= 4).slice(-MAX));
}

export async function loadSpeeds() {
  const { [KEY]: raw } = await browser.storage.local.get(KEY);
  return normalizeSpeeds(raw);
}

// Called only inside the background writer queue.
export async function writeSpeed(channel, rate) {
  if (typeof channel !== 'string' || !channel || channel.length > 512 ||
      (rate !== null && (!Number.isFinite(rate) || rate < 0.25 || rate > 4))) throw new Error('Invalid speed');
  const speeds = await loadSpeeds();
  delete speeds[channel];
  if (rate !== null) Object.defineProperty(speeds, channel, { value: rate, enumerable: true, configurable: true });
  await browser.storage.local.set({ [KEY]: normalizeSpeeds(speeds) });
}

export async function saveSpeed(channel, rate) {
  const res = await browser.runtime.sendMessage({ type: 'bft:speed', channel, rate });
  if (!res?.ok) throw new Error(res?.error || 'Could not save speed');
}

export function onSpeedsChanged(cb) {
  const listener = (changes, area) => {
    if (area === 'local' && KEY in changes) cb(normalizeSpeeds(changes[KEY].newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
