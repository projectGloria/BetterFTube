import { onAttrChange, waitFor } from './dom.js';

const NO_SCROLL = 'data-bft-no-scroll';
const HIDE_BELOW = 32;
const SHOW_ABOVE = 48;

// YouTube can leave a tiny scroll range after watch-page sections are hidden.
// Measure the actual page rather than permanently removing its scrollbar.
export function updateWatchScrollbar() {
  const root = document.documentElement;
  if (location.pathname !== '/watch' || !root.hasAttribute('data-bft-on')) {
    root.removeAttribute(NO_SCROLL);
    return;
  }
  const pageHeight = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
  const excess = pageHeight - window.innerHeight;
  if (root.hasAttribute(NO_SCROLL)) {
    if (excess > SHOW_ABOVE) root.removeAttribute(NO_SCROLL);
  } else if (excess <= HIDE_BELOW) {
    root.setAttribute(NO_SCROLL, '');
  }
}

export async function startWatchScrollbar(signal) {
  const flexy = await waitFor('ytd-watch-flexy', { signal });
  if (!flexy || signal.aborted) return;
  let frame = 0;
  const scan = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!signal.aborted) updateWatchScrollbar();
    });
  };
  scan();
  const mutations = new MutationObserver(scan);
  mutations.observe(flexy, { childList: true, subtree: true });
  const resize = new ResizeObserver(scan);
  resize.observe(document.body ?? flexy);
  resize.observe(flexy);
  const stopSettings = onAttrChange([
    'on', 'limit-suggestions', 'hide-related', 'hide-comments',
    'hide-description', 'hide-live-chat', 'hide-merch', 'hide-endscreen',
  ], scan);
  window.addEventListener('resize', scan);
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    mutations.disconnect();
    resize.disconnect();
    stopSettings();
    window.removeEventListener('resize', scan);
    document.documentElement.removeAttribute(NO_SCROLL);
  }, { once: true });
}
