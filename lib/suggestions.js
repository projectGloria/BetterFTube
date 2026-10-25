import { onAttrChange, valueOf, waitFor } from './dom.js';

const TILE = 'ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer, yt-lockup-view-model, ytd-video-renderer';
const OVERFLOW = 'data-bft-suggestion-overflow';

// Count actual recommendation tiles in DOM order. Remove old marks first so
// changing the limit upward can reveal tiles hidden by the previous limit.
export function limitSuggestions(related, limit, visible = (el) => el.getClientRects().length > 0) {
  related.querySelectorAll(`[${OVERFLOW}]`).forEach((el) => el.removeAttribute(OVERFLOW));
  if (!Number.isFinite(limit) || limit <= 0) return;
  let shown = 0;
  for (const tile of related.querySelectorAll(TILE)) {
    if (tile.parentElement?.closest(TILE) || !visible(tile)) continue;
    if (++shown > Math.floor(limit)) tile.setAttribute(OVERFLOW, '');
  }
}

export async function startSuggestionLimit(signal) {
  const related = await waitFor('ytd-watch-flexy #related', { signal });
  if (!related || signal.aborted) return;
  let queued = false;
  const scan = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!signal.aborted) limitSuggestions(related, Number(valueOf('limit-suggestions')));
    });
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(related, { childList: true, subtree: true });
  const stopWatchingSetting = onAttrChange(['limit-suggestions', 'hide-related'], scan);
  signal.addEventListener('abort', () => {
    observer.disconnect();
    stopWatchingSetting();
  }, { once: true });
}
