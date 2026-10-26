import { useCallback, useSyncExternalStore } from 'react';
import { loadSettings, onSettingsChanged, updateSettings } from '../lib/settings.js';
import { serialQueue } from '../lib/mutations.js';
let snapshot = null;
let error = '';
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
const enqueue = serialQueue();
let changed = false;
// Bumped per storage event, so a save can tell whether anything newer landed
// while its request was in flight.
let revision = 0;
onSettingsChanged(s => { changed = true; revision++; snapshot = s; emit(); });
loadSettings().then(s => { if (!changed) snapshot = s; emit(); }).catch(e => { error = e.message; emit(); });
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function useSettings() {
  const settings = useSyncExternalStore(subscribe, () => snapshot);
  const saveError = useSyncExternalStore(subscribe, () => error);
  const update = useCallback(fn => enqueue(async () => {
    try {
      const seen = revision;
      const committed = await updateSettings(fn);
      // Publish what the background committed right away instead of waiting
      // for storage.onChanged: callers (ListEditor) drop their draft as soon as
      // this resolves, and would otherwise render the pre-save value for a
      // beat. Skipped when an event arrived meanwhile: that snapshot is at
      // least as new as ours, and may include another tab's write.
      if (committed && revision === seen) snapshot = committed;
      error = ''; emit();
      return true;
    } catch (e) {
      error = `Could not save: ${e.message}`; emit();
      return false;
    }
  }), []);
  return [settings, update, saveError];
}
