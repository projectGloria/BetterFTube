import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// Asks the active tab's content script how many elements each toggle's selectors
// match right now. This is the "is my selector still alive?" tool: if YouTube
// renames a component, the badge for that toggle drops to 0 on pages where
// the thing is obviously visible.
//
// Returns null when the active tab isn't YouTube (sendMessage rejects: no
// receiver), which is the expected case, not an error.
export function useDiagnostics(selectors = false, settings = null) {
  const [diag, setDiag] = useState(null);

  useEffect(() => {
    // `alive` guards against setState after unmount AND against StrictMode's
    // dev double-invoke, where the first effect's response can land after the
    // second effect started. Classic async-effect race; AbortController can't
    // cancel a sendMessage, so a flag it is.
    let alive = true;
    const refresh = async () => {
      try {
        // No "tabs" permission needed: we only use tab.id, not url/title.
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null) return;
        const res = await browser.tabs.sendMessage(tab.id, { type: 'bft:diagnose', selectors }, { frameId: 0 });
        if (alive && res) setDiag(res);
      } catch {
        /* not a YouTube tab, or tab opened before install */
      }
    };
    refresh();
    // Expensive selector counts are opt-in. The normal popup gets one cheap
    // status refresh per settings change, with no background polling.
    const timer = selectors ? setInterval(refresh, 3000) : null;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectors, settings]);

  return diag;
}

// Map a diagnostics result to the Badge value for one feature.
export function badgeFor(diag, feature) {
  if (!diag || !feature.hide) return undefined;
  if (diag.invalid.includes(feature.id)) return 'invalid';
  return diag.counts[feature.id];
}
