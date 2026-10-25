// Feed filters: parse the text YouTube shows on a tile, decide whether to hide.
// Pure functions, unit-tested in tests/unit.test.js.
//
// English UI only: "1.2M views", "3 days ago". Anything unparseable returns
// null and null NEVER causes a hide. A filter that silently eats half your feed
// because YouTube changed a string is worse than one that silently does nothing.

const TIME_RE = /^\d{1,3}(?::\d{2}){1,2}$/;

// "12:34" → 754, "1:02:03" → 3723
export function parseDuration(text) {
  const t = text?.trim();
  if (!t || !TIME_RE.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

const VIEWS_RE = /^([\d.,]+)\s*([KMB])?\s+views?$/i;
const MULT = { K: 1e3, M: 1e6, B: 1e9 };

// "1,234 views" → 1234, "1.2M views" → 1200000, "No views" → 0
export function parseViews(text) {
  const t = text?.trim();
  if (!t) return null;
  if (/^no views$/i.test(t)) return 0;
  const m = t.match(VIEWS_RE);
  if (!m) return null; // also rejects "1.2K watching" (live), on purpose
  // Commas are thousands separators in English UI; with a suffix ("1.2K") the
  // dot is a decimal point. Never both in one string.
  const n = Number(m[1].replaceAll(',', ''));
  return Number.isFinite(n) ? Math.round(n * (MULT[m[2]?.toUpperCase()] ?? 1)) : null;
}

const AGE_RE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;
const DAYS = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };

// "3 days ago" → 3, "Streamed 2 weeks ago" → 14, "1 year ago" → 365
export function parseAgeDays(text) {
  const m = text?.match(AGE_RE);
  return m ? Number(m[1]) * DAYS[m[2].toLowerCase()] : null;
}

// First metadata string that parses, so we don't care which span is which:
// the order of "views" and "age" differs between layouts.
const firstParsed = (texts, parse) => {
  for (const t of texts) {
    const v = parse(t);
    if (v !== null) return v;
  }
  return null;
};

export function parseTileStats({ durationText, metaTexts = [] }) {
  return {
    seconds: parseDuration(durationText),
    views: firstParsed(metaTexts, parseViews),
    ageDays: firstParsed(metaTexts, parseAgeDays),
  };
}

// config: { minMinutes, maxMinutes, minViews, maxAgeDays, allow: string[] | null }
// Zero/absent = criterion off. Returns null when nothing is active, so the
// scanner can skip the work entirely.
export function compileFilters({ minMinutes = 0, maxMinutes = 0, minViews = 0, maxAgeDays = 0, allow = null } = {}) {
  const allowSet = allow?.length ? new Set(allow.map((c) => c.toLowerCase())) : null;
  if (!minMinutes && !maxMinutes && !minViews && !maxAgeDays && !allowSet) return null;

  return (tile) => {
    const { seconds, views, ageDays } = parseTileStats(tile);
    if (minMinutes && seconds !== null && seconds < minMinutes * 60) return true;
    if (maxMinutes && seconds !== null && seconds > maxMinutes * 60) return true;
    if (minViews && views !== null && views < minViews) return true;
    if (maxAgeDays && ageDays !== null && ageDays > maxAgeDays) return true;
    if (allowSet && (tile.channel || tile.handle || tile.channelId)) {
      const ok =
        (tile.channelId && allowSet.has(tile.channelId.toLowerCase())) ||
        (tile.channel && allowSet.has(tile.channel.toLowerCase())) ||
        (tile.handle && allowSet.has(tile.handle.toLowerCase()));
      if (!ok) return true;
    }
    return false;
  };
}
