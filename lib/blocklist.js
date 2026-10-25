import { RE2JS } from 're2js';
import { LIMITS } from './validation.js';
// Blocklist matching. Pure functions, no DOM/extension APIs, so it's unit-testable
// with plain `node --test`.
//
// Keywords (match video titles):
//   foo bar        case-insensitive substring
//   /re(gex)?/     regular expression, always case-insensitive
// Channels (match the uploader):
//   @handle        matches the channel's handle (from its /@handle link)
//   Channel Name   matches the display name exactly, case-insensitive

const REGEX_LINE = /^\/(.+)\/$/;
const MAX_REGEXES = 50;
const MAX_PATTERN_CHARS = 4096;

export function compileMatcher({ keywords = [], channels = [] } = {}) {
  const substrings = [];
  const regexes = [];
  let patternChars = 0;
  for (const k of keywords.slice(0, LIMITS.list)) {
    if (k.length > LIMITS.entry) continue;
    const m = k.match(REGEX_LINE);
    if (!m) {
      substrings.push(k.toLowerCase());
      continue;
    }
    // Invalid user regex = skip that line, never throw: one typo shouldn't
    // take down the whole blocklist (or the content script).
    try {
      if (regexes.length >= MAX_REGEXES || patternChars + m[1].length > MAX_PATTERN_CHARS) continue;
      regexes.push(RE2JS.compile(m[1], RE2JS.CASE_INSENSITIVE));
      patternChars += m[1].length;
    } catch {
      /* ignored on purpose, surfaced in the options page via validateKeywords */
    }
  }
  const channelSet = new Set(channels.map((c) => c.toLowerCase()));

  if (!substrings.length && !regexes.length && !channelSet.size) return null;

  return ({ title = '', channel = '', handle = '', channelId = '' }) => {
    if (channelSet.size) {
      if (channelId && channelSet.has(channelId.toLowerCase())) return true;
      if (channel && channelSet.has(channel.toLowerCase())) return true;
      if (handle && channelSet.has(handle.toLowerCase())) return true;
    }
    if (!title) return false;
    const bounded = title.slice(0, 2000);
    const t = bounded.toLowerCase();
    return substrings.some((s) => t.includes(s)) || regexes.some((r) => r.test(bounded));
  };
}

// For the options page: lines that look like regexes but don't compile.
export function invalidRegexLines(keywords) {
  let count = 0;
  let chars = 0;
  return keywords.filter((k) => {
    if (k.length > LIMITS.entry) return true;
    const m = k.match(REGEX_LINE);
    if (!m) return false;
    try {
      if (count >= MAX_REGEXES || chars + m[1].length > MAX_PATTERN_CHARS) return true;
      RE2JS.compile(m[1], RE2JS.CASE_INSENSITIVE);
      count++; chars += m[1].length;
      return false;
    } catch {
      return true;
    }
  });
}
