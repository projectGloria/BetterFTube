import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// Which of the given origins the browser has actually granted. Needed because
// the setting and the grant can diverge: the popup may close mid-prompt (Chrome
// does that on some platforms), or the user revokes access in chrome://extensions.
// `origins` must be a stable reference (or the joined key changes), so the
// effect depends on the joined string, not the array identity.
export function usePermissions(origins) {
  const key = origins.join('|');
  const [granted, setGranted] = useState(() => new Set());

  const refresh = useCallback(async () => {
    const list = key ? key.split('|') : [];
    const results = await Promise.all(list.map((o) => browser.permissions.contains({ origins: [o] })));
    setGranted(new Set(list.filter((_, i) => results[i])));
  }, [key]);

  useEffect(() => {
    refresh();
    // Grants can change while the page is open (Options open in a tab)
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);

  return granted;
}
