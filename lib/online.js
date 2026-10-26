// Content-side half of the opt-in network features. No fetch() here: content
// scripts are bound by youtube.com's CORS, and host permissions don't lift
// that in MV3. The background worker does the requests (lib/api.js).
import { browser } from 'wxt/browser';
import { onNavigate, waitFor } from './dom.js';

const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

// ── SponsorBlock ────────────────────────────────────────────────────────

let settings = null;
let generation = 0;
let statuses = { sponsorblock: 'Off', dislikes: 'Off' };
const active = id => settings?.enabled && settings.features[id] && settings.features[id] !== 'off';
export const onlineStatus = () => ({ ...statuses });

let segments = []; // [{ start, end, category, uuid }] for the current video
let segmentsFor = null;
const skipped = new Set(); // uuids: skip each segment once, so seeking back INTO one is respected
let onSkip = null; // toast callback, injected by startOnline

async function loadSegments() {
  const token = ++generation;
  const videoId = currentVideoId();
  const categories = active('sponsorblock') && settings.features.sponsorblock;
  statuses.sponsorblock = categories ? (videoId ? 'Loading' : 'Open a video') : 'Off';
  segments = [];
  segmentsFor = videoId;
  skipped.clear();
  if (!videoId || !categories) return;
  const res = await browser.runtime
    .sendMessage({ type: 'bft:sb-segments', videoId, categories: categories.split(',') })
    .catch(() => null);
  // Stale-response guard: user may have navigated on while the request was in flight
  if (token !== generation || segmentsFor !== currentVideoId() || !active('sponsorblock')) return;
  statuses.sponsorblock = res?.ok ? (res.segments.length ? 'Ready' : 'No segments') : (res?.error || 'Request failed');
  if (res?.ok) segments = res.segments;
}

function onTimeUpdate(e) {
  if (!active('sponsorblock') || segmentsFor !== currentVideoId() || !segments.length) return;
  const video = e.target;
  // Only the main player; YouTube also has hover-preview videos on thumbnails
  if (!(video instanceof HTMLVideoElement) || !video.closest('#movie_player')) return;
  if (document.getElementById('movie_player')?.classList.contains('ad-showing')) return;
  const t = video.currentTime;
  for (const s of segments) {
    // -0.3s slack: timeupdate fires every ~250ms, landing right before `end`
    // would otherwise "skip" 0.1s and toast for nothing.
    if (t >= s.start && t < s.end - 0.3 && !skipped.has(s.uuid)) {
      skipped.add(s.uuid);
      const end = Number.isFinite(video.duration) ? Math.min(s.end, video.duration) : s.end;
      if (end <= t) continue;
      video.currentTime = end;
      onSkip?.(s);
      return;
    }
  }
}

// ── Return YouTube Dislike ──────────────────────────────────────────────

const DISLIKE_BUTTON =
  'ytd-watch-metadata dislike-button-view-model button, ytd-watch-metadata #segmented-dislike-button button';
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
let dislikeAbort;

async function showDislikes() {
  dislikeAbort?.abort();
  dislikeAbort = new AbortController();
  const { signal } = dislikeAbort;
  document.querySelectorAll('.bft-dislikes').forEach((el) => el.remove());
  const videoId = currentVideoId();
  statuses.dislikes = active('dislikes') ? (videoId ? 'Loading' : 'Open a video') : 'Off';
  if (!videoId || !active('dislikes')) return;

  const res = await browser.runtime.sendMessage({ type: 'bft:dislikes', videoId }).catch(() => null);
  if (signal.aborted) return;
  statuses.dislikes = res?.ok ? 'Ready' : (res?.error || 'Request failed');
  if (!res?.ok) return;
  const button = await waitFor(DISLIKE_BUTTON, { signal });
  if (!button || signal.aborted) return;

  const span = document.createElement('span');
  span.className = 'bft-dislikes';
  span.textContent = compact.format(res.dislikes);
  span.title = 'Estimated dislikes (Return YouTube Dislike)';
  span.style.cssText = 'margin-left:6px;font-weight:500';
  button.append(span);
  // The button is YouTube-rendered: liking/disliking or a late re-render
  // replaces its children and silently drops our span. Re-attach while this
  // video is current; the abort on the next refresh/navigation disconnects.
  const keep = new MutationObserver(() => {
    if (!span.isConnected || span.parentElement !== button) button.append(span);
  });
  keep.observe(button, { childList: true });
  signal.addEventListener('abort', () => keep.disconnect(), { once: true });
}

// ── Wiring ──────────────────────────────────────────────────────────────

export function startOnline({ onSkip: cb }) {
  onSkip = cb;
  document.addEventListener('timeupdate', onTimeUpdate, true);
  const refresh = () => {
    loadSegments();
    showDislikes();
  };
  onNavigate(refresh);
  document.addEventListener('yt-navigate-start', () => {
    generation++; segments = []; segmentsFor = null; dislikeAbort?.abort();
    document.querySelectorAll('.bft-dislikes').forEach(el => el.remove());
  });
  // Per-feature: changing SponsorBlock categories used to tear down and
  // re-request the dislike count too (and vice versa).
  const stateOf = (s, id) => `${s?.enabled}|${s?.features[id]}`;
  return (next = settings, force = false) => {
    const sb = force || stateOf(next, 'sponsorblock') !== stateOf(settings, 'sponsorblock');
    const dl = force || stateOf(next, 'dislikes') !== stateOf(settings, 'dislikes');
    settings = next;
    if (sb) loadSegments();
    if (dl) showDislikes();
  };
}
