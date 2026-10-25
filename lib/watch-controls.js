// YouTube replaces the watch action row during SPA navigation and A/B tests.
// Mark the actual controls so the feature CSS can stay scoped to this page.
import { isOn, waitFor } from './dom.js';

const ACTION_HOST = 'yt-button-view-model, ytd-button-renderer, button-view-model';
const iconType = (button) => button.querySelector('yt-icon[icon-type]')?.getAttribute('icon-type')?.toUpperCase() ?? '';
const label = (button) => [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
  .filter(Boolean).join(' ').trim();

export function markWatchControls(metadata) {
  const buttons = metadata.matches('ytd-watch-flexy')
    ? metadata.querySelectorAll('ytd-watch-metadata button, #owner button, #actions button, #top-row button')
    : metadata.querySelectorAll('button');
  for (const button of buttons) {
    const host = button.closest(ACTION_HOST) ?? button;
    const name = label(button);
    const icon = iconType(button);
    if (button.closest('#share-button') || /\bshare\b/i.test(name) || icon === 'SHARE') {
      button.classList.add('bft-share-button');
      host.classList.add('bft-share-control');
    }
    if (button.closest('#save-button') || /^(save|save to playlist)(?:\s|$)/i.test(name) || icon === 'BOOKMARK')
      host.classList.add('bft-save-button');
    if (button.closest('yt-subscription-notification-toggle-button-renderer, ytd-subscription-notification-toggle-button-renderer') ||
        /\bnotifications?\b/i.test(name) || /\bbell\b/i.test(name) ||
        icon.startsWith('NOTIFICATION') || icon.includes('BELL'))
      (host.querySelectorAll('button').length === 1 ? host : button).classList.add('bft-notification-bell');
    if (/\bmore (?:actions|options)\b/i.test(name) || /^MORE(?:_HORIZ|_VERT|_HORIZONTAL|_VERTICAL)?$/.test(icon))
      (host.querySelectorAll('button').length === 1 ? host : button).classList.add('bft-more-actions');
    if (!button.closest('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer') &&
        (/^(?:like|dislike)(?:\s|$)/i.test(name) || icon === 'LIKE' || icon === 'DISLIKE'))
      button.classList.add('bft-like-dislike');
  }
}

export async function startWatchControls(signal) {
  const metadata = await waitFor('ytd-watch-flexy', { signal });
  if (!metadata || signal.aborted) return;
  let queued = false;
  const scan = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!signal.aborted) markWatchControls(metadata);
    });
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(metadata, { childList: true, subtree: true });
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}

export function shortWatchUrl(href = location.href) {
  const id = new URL(href).searchParams.get('v');
  return id && /^[\w-]{11}$/.test(id) ? `https://youtu.be/${id}` : null;
}

function copyWatchUrl(onError, onCopied) {
  const url = shortWatchUrl();
  if (!url) return;
  navigator.clipboard.writeText(url)
    .then(() => onCopied?.())
    .catch((error) => onError(`Could not copy link: ${error.message}`));
}

export function interceptShareClick(event, onError) {
  if (location.pathname !== '/watch' || !isOn('minimal-share')) return;
  const button = event.target.closest?.('button.bft-share-button');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  copyWatchUrl(onError);
}

export function interceptCopyShortcut(event, onError, onCopied) {
  if (location.pathname !== '/watch' || !isOn('hide-share-button')) return;
  if (event.key?.toLowerCase() !== 'c' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.target.closest?.('input, textarea, [contenteditable], [role="textbox"]')) return;
  if (window.getSelection()?.toString()) return;
  if (!shortWatchUrl()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  copyWatchUrl(onError, onCopied);
}
