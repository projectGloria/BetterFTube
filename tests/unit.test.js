// Pure-logic tests. Run: npm test  (node's built-in runner, zero deps)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchSegments, isVideoId, parseSegments, sha256Hex } from '../lib/api.js';
import { compileMatcher, invalidRegexLines } from '../lib/blocklist.js';
import { FEATURES, GROUPS, HOVER_RULES, attrValue, buildCustomStylesheet, buildStylesheet } from '../lib/features.js';
import { compileFilters, parseAgeDays, parseDuration, parseViews } from '../lib/filters.js';
import { BUILTIN_PRESETS, activePreset, applyPreset, nextPreset } from '../lib/presets.js';
import { DEFAULTS, cleanList, isSafeSelector, normalize } from '../lib/settings.js';

test('feature list is internally consistent', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature id');
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const f of FEATURES) {
    // kebab-case only: HTML lowercases attribute names, camelCase would never match
    assert.match(f.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${f.id}: id must be kebab-case`);
    assert.ok(groups.has(f.group), `${f.id}: unknown group ${f.group}`);
    if (f.type === 'select') {
      assert.ok(f.options.some((o) => o.value === f.default), `${f.id}: default not in options`);
    } else if (f.type === 'number') {
      assert.ok(f.default >= f.min && f.default <= f.max, `${f.id}: default out of range`);
      assert.ok(f.unit, `${f.id}: number needs a unit`);
    } else {
      assert.equal(typeof f.default, 'boolean', `${f.id}: toggle default must be boolean`);
    }
  }
});

test('stylesheet: one gated rule per selector', () => {
  const css = buildStylesheet();
  const expected = FEATURES.reduce((n, f) => n + (f.hide?.length ?? 0), 0) + 16 + HOVER_RULES.length; // filter, reveal, suggestion, share, alignment, scrollbar, and hover rules
  const rules = css.split('\n');
  assert.equal(rules.length, expected);
  for (const r of rules) assert.match(r, /^html\[data-bft-[a-z0-9-]+(?:="(?:center|right)")?\](?:\[data-bft-(?:no-scroll|reveal|watch)\]|:not\(\[data-bft-reveal\]\))*(?: .+)? \{ .+ !important; \}$/);
  assert.match(css, /grid-template-columns: minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(css, /align-items: center !important; margin-top: 12px !important;/);
  // Scroll overrides are scoped to watch pages: elsewhere they would defeat
  // YouTube's scroll locks for dialogs and the guide drawer.
  assert.match(css, /html\[data-bft-on\]\[data-bft-watch\] \{ overflow-y: auto !important; scrollbar-gutter: auto !important; \}/);
  assert.doesNotMatch(css, /html\[data-bft-on\] (?:body )?\{ overflow-y/);
  // Reveal lifts blocklist/filter hiding through the gate, never via `display: revert`.
  assert.match(css, /html\[data-bft-blocklist\]:not\(\[data-bft-reveal\]\) \[data-bft-blocked\] \{ display: none !important; \}/);
  assert.doesNotMatch(css, /revert/);
});

test('custom stylesheet: rules gated as a whole via :is(), css only when enabled', () => {
  const custom = {
    css: 'body { color: red }',
    rules: [
      { id: 'a', selector: 'x-a, x-b', enabled: true },
      { id: 'b', selector: 'x-off', enabled: false },
    ],
  };
  assert.equal(buildCustomStylesheet(custom, { cssEnabled: false }), 'html[data-bft-on] :is(x-a, x-b) { display: none !important; }');
  assert.match(buildCustomStylesheet(custom, { cssEnabled: true }), /body \{ color: red \}$/);
});

test('attrValue maps settings to attribute presence/value', () => {
  const toggle = { type: undefined };
  const select = { type: 'select' };
  const number = { type: 'number' };
  assert.equal(attrValue(number, 5), '5');
  assert.equal(attrValue(number, 0), null);
  assert.equal(attrValue(toggle, true), '');
  assert.equal(attrValue(toggle, false), null);
  assert.equal(attrValue(select, 'hd1080'), 'hd1080');
  assert.equal(attrValue(select, 'off'), null);
});

test('normalize: fills defaults, drops junk, validates selects', () => {
  const s = normalize({
    enabled: 'yes', // wrong type → default
    features: { 'hide-shorts': false, 'default-quality': 'hd9999', 'not-a-feature': true },
    lists: { keywords: ['  a ', 'A', '', 42, 'b'], channels: 'nope' },
  });
  assert.equal(s.enabled, true);
  assert.equal(s.features['hide-shorts'], false);
  assert.equal(s.features['default-quality'], 'off');
  assert.ok(!('not-a-feature' in s.features));
  assert.deepEqual(s.lists, { keywords: ['a', 'b'], channels: [], allow: [] });
  assert.deepEqual(normalize(undefined), normalize(DEFAULTS));
});

test('cleanList trims, dedupes case-insensitively, keeps first spelling', () => {
  assert.deepEqual(cleanList(['Foo', 'foo ', ' bar', '']), ['Foo', 'bar']);
});

test('blocklist matcher', () => {
  assert.equal(compileMatcher({ keywords: [], channels: [] }), null, 'empty lists → no matcher');

  const m = compileMatcher({
    keywords: ['reaction', '/\\bunbox(ing)?\\b/', '/[broken/'],
    channels: ['@SpamChannel', 'Clickbait Central'],
  });
  assert.ok(m({ title: 'My REACTION to stuff' }), 'substring, case-insensitive');
  assert.ok(m({ title: 'Unboxing the thing' }), 'regex');
  assert.ok(!m({ title: 'Boxing match' }), 'regex word boundary');
  assert.ok(m({ title: 'x', handle: '@spamchannel' }), 'handle, case-insensitive');
  assert.ok(m({ title: 'x', channel: 'clickbait central' }), 'display name exact');
  assert.ok(!m({ title: 'x', channel: 'Clickbait Central Fans' }), 'name is exact, not substring');
  assert.ok(!m({ title: '' }), 'empty tile never matches');
});

test('invalidRegexLines reports only broken regex lines', () => {
  assert.deepEqual(invalidRegexLines(['plain', '/ok/', '/[bad/']), ['/[bad/']);
});

test('normalize: v2 shapes (numbers clamp, unsafe selectors dropped, presets sanitized)', () => {
  const s = normalize({
    features: { 'filter-min-duration': 99999, 'filter-min-views': -5, 'filter-max-age': 'x' },
    lists: { allow: ['@a', '@A'] },
    custom: {
      css: 42,
      rules: [
        { id: 'r1', selector: 'ytd-foo', label: '' },
        { id: 'r1', selector: 'ytd-bar' }, // duplicate id → reassigned
        { selector: 'x { } body { display:none' }, // injection attempt
        { selector: '' },
      ],
    },
    presets: [{ name: '  Mine ', features: { 'hide-comments': true } }, { name: '' }, null],
  });
  assert.equal(s.features['filter-min-duration'], 600, 'clamped to max');
  assert.equal(s.features['filter-min-views'], 0, 'clamped to min');
  assert.equal(s.features['filter-max-age'], 0, 'non-number → default');
  assert.deepEqual(s.lists.allow, ['@a']);
  assert.equal(s.custom.css, '');
  assert.deepEqual(s.custom.rules.map((r) => r.selector), ['ytd-foo', 'ytd-bar']);
  assert.notEqual(s.custom.rules[0].id, s.custom.rules[1].id);
  assert.equal(s.custom.rules[0].label, 'ytd-foo', 'empty label falls back to selector');
  assert.equal(s.presets.length, 1);
  assert.equal(s.presets[0].name, 'Mine');
  assert.match(s.presets[0].id, /^user:/);
  assert.equal(s.presets[0].features['hide-comments'], true);
});

test('isSafeSelector', () => {
  assert.ok(isSafeSelector('ytd-x[title="a b"] > #y'));
  for (const bad of ['', '  ', 'a{', 'a;b', '/* x */ a', null]) assert.ok(!isSafeSelector(bad), String(bad));
});

test('filter parsers', () => {
  assert.equal(parseDuration('12:34'), 754);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('LIVE'), null);
  assert.equal(parseViews('1,234 views'), 1234);
  assert.equal(parseViews('1.2M views'), 1_200_000);
  assert.equal(parseViews('3K views'), 3000);
  assert.equal(parseViews('No views'), 0);
  assert.equal(parseViews('1 view'), 1);
  assert.equal(parseViews('1.2K watching'), null, 'live viewers are not views');
  assert.equal(parseAgeDays('3 days ago'), 3);
  assert.equal(parseAgeDays('Streamed 2 weeks ago'), 14);
  assert.equal(parseAgeDays('1 year ago'), 365);
  assert.equal(parseAgeDays('Premieres in 3 hours'), null);
});

test('compileFilters: thresholds, allowlist, fail-open on missing data', () => {
  assert.equal(compileFilters({}), null, 'nothing active → no work');
  const f = compileFilters({ minMinutes: 2, maxMinutes: 60, minViews: 1000, maxAgeDays: 30 });
  const tile = (durationText, ...metaTexts) => ({ durationText, metaTexts });
  assert.ok(f(tile('0:45', '5K views', '1 day ago')), 'too short');
  assert.ok(f(tile('1:30:00', '5K views', '1 day ago')), 'too long');
  assert.ok(f(tile('10:00', '12 views', '1 day ago')), 'too few views');
  assert.ok(f(tile('10:00', '5K views', '2 years ago')), 'too old');
  assert.ok(!f(tile('10:00', '5K views', '1 day ago')), 'passes all');
  assert.ok(!f(tile('', 'weird text')), 'unparseable → kept');

  const allow = compileFilters({ allow: ['@good', 'Good Name'] });
  assert.ok(!allow({ handle: '@Good' }));
  assert.ok(!allow({ channel: 'good name' }));
  assert.ok(allow({ channel: 'Someone Else' }));
  assert.ok(!allow({}), 'no channel info → kept');
});

test('presets: active detection, cycling, apply keeps lists', () => {
  const base = normalize({});
  assert.equal(activePreset(base)?.id, 'builtin:default');
  const focus = BUILTIN_PRESETS.find((p) => p.id === 'builtin:focus');
  assert.equal(nextPreset(base).id, 'builtin:focus');
  const withList = { ...base, lists: { ...base.lists, keywords: ['x'] } };
  const applied = applyPreset(withList, focus);
  assert.equal(activePreset(applied)?.id, 'builtin:focus');
  assert.deepEqual(applied.lists.keywords, ['x']);
  assert.equal(nextPreset(applied).id, 'builtin:default', 'wraps around');
  const custom = { ...base, features: { ...base.features, 'hide-comments': true, 'hide-mixes': true } };
  assert.equal(activePreset(custom), null);
  assert.equal(nextPreset(custom).id, 'builtin:default', 'unsaved state → first preset');
});

test('SponsorBlock: hash-prefix request, local filtering', async () => {
  assert.equal((await sha256Hex('abc')).slice(0, 8), 'ba7816bf');
  let url;
  const fakeFetch = async (u) => {
    url = u;
    return {
      ok: true,
      status: 200,
      json: async () => [
        { videoID: 'other_video', segments: [{ segment: [0, 5], category: 'sponsor', actionType: 'skip', UUID: 'x' }] },
        {
          videoID: 'dQw4w9WgXcQ',
          segments: [
            { segment: [30, 45], category: 'sponsor', actionType: 'skip', UUID: 'b' },
            { segment: [5, 10], category: 'selfpromo', actionType: 'skip', UUID: 'a' },
            { segment: [50, 50], category: 'poi_highlight', actionType: 'poi', UUID: 'c' },
          ],
        },
      ],
    };
  };
  const segs = await fetchSegments('dQw4w9WgXcQ', ['sponsor', 'selfpromo'], fakeFetch);
  const prefix = (await sha256Hex('dQw4w9WgXcQ')).slice(0, 4);
  assert.ok(url.includes(`/skipSegments/${prefix}?`), 'only the 4-char prefix is sent');
  assert.ok(!url.includes('dQw4w9WgXcQ'), 'video id never leaves the browser');
  assert.deepEqual(segs.map((s) => s.uuid), ['a', 'b'], 'ours only, skip-only, sorted');
  assert.deepEqual(parseSegments(null, 'x'), []);
});

test('isVideoId', () => {
  assert.ok(isVideoId('dQw4w9WgXcQ'));
  for (const bad of ['short', 'dQw4w9WgXcQ!', '../../etc/pa', null]) assert.ok(!isVideoId(bad), String(bad));
});
