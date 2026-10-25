import { useCallback, useSyncExternalStore } from 'react';
import { loadSettings, onSettingsChanged, updateSettings } from '../lib/settings.js';
import { serialQueue } from '../lib/mutations.js';
let snapshot = null;
let error = '';
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
const enqueue = serialQueue();
let changed = false;
onSettingsChanged(s => { changed = true; snapshot = s; emit(); });
loadSettings().then(s => { if (!changed) snapshot = s; emit(); }).catch(e => { error = e.message; emit(); });
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function useSettings() {
  const settings = useSyncExternalStore(subscribe, () => snapshot);
  const saveError = useSyncExternalStore(subscribe, () => error);
  const update = useCallback(fn => enqueue(async () => {
    try {
      await updateSettings(fn);
      error = ''; emit();
      return true;
    } catch (e) {
      error = `Could not save: ${e.message}`; emit();
      return false;
    }
  }), []);
  return [settings, update, saveError];
}
