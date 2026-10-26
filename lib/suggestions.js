import { isOn, onAttrChange, valueOf, waitFor } from './dom.js';

const TILE = 'ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer, yt-lockup-view-model, ytd-video-renderer';
const OVERFLOW = 'data-bft-suggestion-overflow';

// Mirrors the gates of the blocklist/filter hide rules in buildStylesheet().
const hiddenByMarks = (tile) =>
  (tile.hasAttribute('data-bft-blocked') && isOn('blocklist')) ||
  (tile.hasAttribute('data-bft-filtered') && isOn('on'));

// Count recommendation tiles in DOM order, including our existing overflow
// marks so raising the limit reveals them without first rewriting every tile.
export function limitSuggestions(related, limit, visible = (el) => el.getClientRects().length > 0) {
  if (!Number.isFinite(limit) || limit <= 0) {
    related.querySelectorAll(`[${OVERFLOW}]`).forEach((el) => el.removeAttribute(OVERFLOW));
    return;
  }
  let shown = 0;
  const decisions = [];
  for (const tile of related.querySelectorAll(TILE)) {
    if (tile.parentElement?.closest(TILE)) continue;
    // Existing overflow marks account for their own display:none. Read layout
    // first, then write all marks, avoiding one forced layout per hidden tile.
    // A tile we overflow-hid can't be measured (it's display:none because of
    // us), so it counts as eligible, unless the scanner has since marked it:
    // then it stays hidden either way and must not use up a slot.
    const eligible = !hiddenByMarks(tile) && (tile.hasAttribute(OVERFLOW) || visible(tile));
    decisions.push([tile, eligible && ++shown > Math.floor(limit)]);
  }
  for (const [tile, hide] of decisions)
    if (tile.hasAttribute(OVERFLOW) !== hide) tile.toggleAttribute(OVERFLOW, hide);
}

export async function startSuggestionLimit(signal) {
  const related = await waitFor('ytd-watch-flexy #related', { signal });
  if (!related || signal.aborted) return;
  let timer = 0;
  const scan = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!signal.aborted) limitSuggestions(related, Number(valueOf('limit-suggestions')));
    }, 100);
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' ||
      [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && (node.matches(TILE) || node.querySelector(TILE))))) scan();
  });
  const configure = () => {
    observer.disconnect(); clearTimeout(timer); timer = 0;
    if (!isOn('on') || !Number(valueOf('limit-suggestions')) || isOn('hide-related')) {
      limitSuggestions(related, 0);
      return;
    }
    scan();
    // The blocklist/filter scanner marks tiles AFTER they're inserted. Without
    // watching those marks, a tile hidden later still counted toward the limit
    // and the sidebar showed fewer suggestions than configured. Our own
    // overflow attribute is deliberately not in the filter (no feedback loop).
    observer.observe(related, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-bft-blocked', 'data-bft-filtered'] });
  };
  configure();
  const stopWatchingSetting = onAttrChange(['on', 'limit-suggestions', 'hide-related', 'blocklist'], configure);
  signal.addEventListener('abort', () => {
    observer.disconnect();
    clearTimeout(timer);
    stopWatchingSetting();
  }, { once: true });
}
