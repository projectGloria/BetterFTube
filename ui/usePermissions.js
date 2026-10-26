import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

// Which of the given origins the browser has actually granted. Needed because
// the setting and the grant can diverge: the popup may close mid-prompt (Chrome
// does that on some platforms), or the user revokes access in chrome://extensions.
// `origins` must be a stable reference (or the joined key changes), so the
// effect depends on the joined string, not the array identity.
export function usePermissions(origins) {
  const key = origins.join('|');
  const [granted, setGranted] = useState(() => new Set());
  // Latest-wins: the mount refresh and an onAdded/onRemoved refresh can be in
  // flight together, and an older answer landing last would show a stale grant.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++latest.current;
    const list = key ? key.split('|') : [];
    const results = await Promise.all(list.map((o) => browser.permissions.contains({ origins: [o] })));
    if (run === latest.current) setGranted(new Set(list.filter((_, i) => results[i])));
  }, [key]);

  useEffect(() => {
    refresh();
    // Grants can change while the page is open (Options open in a tab)
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      latest.current++; // drop any in-flight answer after unmount / key change
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);

  return granted;
}
