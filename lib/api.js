// Network calls for the opt-in features. Runs in the background worker only.
// Every request here is gated on (a) the user enabling the feature and (b) the
// browser holding the optional host permission for that exact origin.

const SB_API = 'https://sponsor.ajay.app/api/skipSegments/';
const RYD_API = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const TTL = 10 * 60_000;
const MAX_CACHE = 200;

// Tiny TTL cache. Worker memory only: MV3 kills the worker when idle, which
// just means a cold cache, never stale data.
const cache = new Map();
const pending = new Map();
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const job = load().then(value => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

async function requestJson(url, fetchImpl, missing = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (missing && res.status === 404) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timeout); }
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Privacy-preserving lookup: send only the first 4 hex chars of sha256(videoId).
// The server returns segments for every video sharing that prefix and we pick
// ours locally. A prefix reduces disclosure, but is not guaranteed anonymity.
export async function fetchSegments(videoId, categories, fetchImpl = fetch) {
  const prefix = (await sha256Hex(videoId)).slice(0, 4);
  const cats = [...categories].sort(); // stable cache key regardless of order
  return cached(`sb:${prefix}:${cats}`, async () => {
    return requestJson(`${SB_API}${prefix}?categories=${encodeURIComponent(JSON.stringify(cats))}`, fetchImpl, true);
  }).then((all) => parseSegments(all, videoId, cats));
}

const CATEGORIES = new Set(['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler']);
export function parseSegments(all, videoId, categories = [...CATEGORIES]) {
  const entry = Array.isArray(all) ? all.find(v => v?.videoID === videoId) : null;
  if (!Array.isArray(entry?.segments)) return [];
  return entry.segments.slice(0, 1000)
    .filter(s => s?.actionType === 'skip' && Array.isArray(s.segment) && s.segment.length === 2 &&
      typeof s.UUID === 'string' && s.UUID.length > 0 && s.UUID.length <= 128 && categories.includes(s.category))
    .map(s => ({ start: s.segment[0], end: s.segment[1], category: s.category, uuid: s.UUID }))
    .filter(s => Number.isFinite(s.start) && s.start >= 0 && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

export function fetchDislikes(videoId, fetchImpl = fetch) {
  return cached(`ryd:${videoId}`, async () => {
    const data = await requestJson(`${RYD_API}${encodeURIComponent(videoId)}`, fetchImpl);
    if (!Number.isSafeInteger(data?.dislikes) || data.dislikes < 0) throw new Error('RYD: bad payload');
    return data.dislikes;
  });
}

// YouTube ids are 11 chars of [A-Za-z0-9_-]; reject anything else before it
// gets anywhere near a URL.
export const isVideoId = (v) => typeof v === 'string' && /^[\w-]{11}$/.test(v);
