import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { invalidRegexLines } from '../../lib/blocklist.js';
import { DEFAULTS, normalize, replaceSettings } from '../../lib/settings.js';
import { loadSpeeds, onSpeedsChanged, saveSpeed } from '../../lib/speeds.js';
import { useSettings } from '../../ui/useSettings.js';
import { LIMITS, validateBackup } from '../../lib/validation.js';
import { ListEditor } from './ListEditor.jsx';
import { RulesEditor } from './RulesEditor.jsx';

const VERSION = browser.runtime.getManifest().version;
const identity = (v) => v;

// Speeds live under their own storage key (see lib/speeds.js), so they get a
// small subscription of their own instead of riding on useSettings.
function useSpeeds() {
  const [speeds, setSpeeds] = useState({});
  useEffect(() => {
    let alive = true;
    loadSpeeds().then((s) => alive && setSpeeds(s));
    const off = onSpeedsChanged(setSpeeds);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return speeds;
}

export default function App() {
  const [settings, update, saveError] = useSettings();
  const speeds = useSpeeds();
  const [status, setStatus] = useState(null); // { ok: bool, text }
  const fileRef = useRef(null);

  const setList = useCallback(
    (key) => (list) => update(s => {
      if (list.filter(v => v.trim()).length > LIMITS.list || list.some(v => v.trim().length > LIMITS.entry)) throw new Error('List exceeds 2,000 entries or 512 characters per entry');
      return { ...s, lists: { ...s.lists, [key]: list } };
    }),
    [update],
  );

  if (!settings) return <p role="status">{saveError || 'Loading settings...'}</p>;

  const exportJson = () => {
    const payload = { app: 'betterftube', version: VERSION, exportedAt: new Date().toISOString(), ...settings, speeds };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `betterftube-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    // Revoke on next tick: revoking synchronously can cancel the download in
    // some engines; never revoking leaks the blob for the page's lifetime.
    setTimeout(() => URL.revokeObjectURL(url));
  };

  const importJson = async (file) => {
    try {
      if (file.size > LIMITS.importBytes) throw new Error('Backup exceeds 2 MB');
      const raw = JSON.parse(await file.text());
      validateBackup(raw);
      const next = normalize(raw);
      const changed = JSON.stringify({ enabled: raw.enabled, features: raw.features, lists: raw.lists, custom: raw.custom, presets: raw.presets }) !==
        JSON.stringify({ enabled: next.enabled, features: next.features, lists: next.lists, custom: next.custom, presets: next.presets });
      const summary = `Replace current settings with ${next.lists.keywords.length} keywords, ${next.lists.channels.length} channels, ${next.custom.rules.length} rules and ${next.presets.length} presets?`;
      if (!confirm(`${summary}\n${changed ? 'Invalid, duplicate, unknown or oversized values were normalized or dropped.\n' : ''}${next.custom.css ? `Includes ${next.custom.css.length} characters of custom CSS, which can load external resources.\n` : ''}${raw.speeds ? 'Remembered speeds will also be replaced.' : 'This older backup does not include speeds; existing speeds will be kept.'}`)) return;
      await replaceSettings(next, raw.speeds);
      setStatus({
        ok: true,
        text: `Imported ${Object.keys(next.features).length} settings, ${next.lists.keywords.length} keywords, ${next.lists.channels.length} channels, ${next.custom.rules.length} rules, ${next.presets.length} presets.`,
      });
    } catch (err) {
      setStatus({ ok: false, text: `Import failed: ${err.message}` });
    } finally {
      fileRef.current.value = ''; // so re-picking the same file fires onChange again
    }
  };

  const resetAll = async () => {
    if (!confirm('Reset all toggles and clear lists, rules, custom CSS, presets and remembered speeds?')) return;
    try {
      await replaceSettings(DEFAULTS, {});
      setStatus({ ok: true, text: 'Everything reset to defaults.' });
    } catch (err) { setStatus({ ok: false, text: `Reset failed: ${err.message}` }); }
  };

  const speedEntries = Object.entries(speeds);

  return (
    <main className="page">
      <header className="page__head">
        <h1 className="title">
          Better<span>F</span>Tube
        </h1>
        <span className="muted">v{VERSION}</span>
        <nav className="toc">
          <a href="#lists">Lists</a>
          <a href="#custom">Custom</a>
          <a href="#presets">Presets</a>
          <a href="#backup">Backup</a>
        </nav>
      </header>

      {saveError && <p role="alert" className="warn">{saveError}</p>}
      <p className="muted">Limits: 2,000 entries per list, 512 characters per entry, 500 rules, 20 presets and 100,000 characters of CSS.</p>
      <h2 className="section" id="lists">Lists</h2>
      <ListEditor
        title="Blocked keywords"
        help="Hides videos whose title matches. One per line. Plain text = case-insensitive substring. /regex/ = linear-time regular expression (case-insensitive). Up to 50 regexes and 4,096 pattern characters. Backreferences and unsupported lookarounds are reported below."
        placeholder={'reaction\nmrbeast\n/\\bunboxing\\b/'}
        value={settings.lists.keywords}
        onSave={setList('keywords')}
        validate={invalidRegexLines}
      />
      <ListEditor
        title="Blocked channels"
        help="One per line. A UC channel ID or @handle matches that identity; other text matches the display name exactly (case-insensitive). Tip: right-click any video on YouTube → Block this channel."
        placeholder={'@SomeChannel\nSome Channel Name'}
        value={settings.lists.channels}
        onSave={setList('channels')}
      />
      <ListEditor
        title="Allowlist"
        help="Used only when Filters → Allowlist mode is on: known channels outside this list are hidden. An empty list disables allowlist filtering; tiles with no channel information stay visible. Same format as blocked channels."
        placeholder={'@ChannelYouTrust\nAnother Channel'}
        value={settings.lists.allow}
        onSave={setList('allow')}
      />
      {!settings.features.blocklist && (
        <p className="warn">"Apply blocklist" is off in the popup, so the blocked keywords/channels currently do nothing.</p>
      )}

      <h2 className="section" id="custom">Custom</h2>
      <RulesEditor rules={settings.custom.rules} onChange={(fn) => update(s => ({ ...s, custom: { ...s.custom, rules: fn(s.custom.rules) } }))} />
      <ListEditor
        title="Custom CSS"
        help="Raw CSS injected on youtube.com, in its own stylesheet (a typo can't break the built-in rules). Toggle it from the popup's Custom group."
        placeholder={'/* e.g. wider grid */\nytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: 6 !important; }'}
        value={settings.custom.css}
        onSave={(css) => update(s => {
          if (css.length > LIMITS.css) throw new Error('CSS exceeds 100,000 characters');
          return { ...s, custom: { ...s.custom, css } };
        })}
        format={identity}
        parse={identity}
        countLabel={(v) => `${v.length.toLocaleString()} chars`}
      />

      <h2 className="section" id="presets">Presets & playback</h2>
      <section className="card">
        <header className="card__head">
          <h2>Your presets</h2>
          <span className="muted">{settings.presets.length}</span>
        </header>
        <p className="muted">
          Save from the popup (set toggles, then <b>+ Save</b>). Cycle presets with Alt+Shift+P. Default and Focus are built in.
        </p>
        {settings.presets.length > 0 ? (
          <ul className="rules">
            {settings.presets.map((p) => (
              <li key={p.id} className="rule">
                <span className="rule__text">{p.name}</span>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => update((s) => ({ ...s, presets: s.presets.filter((x) => x.id !== p.id) }))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">None yet.</p>
        )}
      </section>

      <section className="card">
        <header className="card__head">
          <h2>Remembered speeds</h2>
          <span className="muted">{speedEntries.length} channels</span>
        </header>
        <p className="muted">Recorded when "Remember speed per channel" is on and you change speed on a video.</p>
        {speedEntries.length > 0 ? (
          <ul className="rules">
            {speedEntries.map(([channel, rate]) => (
              <li key={channel} className="rule">
                <span className="rule__text">
                  {channel} <b>{rate}×</b>
                </span>
                <button type="button" className="btn btn--small" onClick={() => saveSpeed(channel, null).catch(err => setStatus({ ok: false, text: err.message }))}>
                  Forget
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">None yet.</p>
        )}
      </section>

      <section className="card">
        <header className="card__head">
          <h2>Keyboard shortcuts</h2>
        </header>
        <p className="muted">
          Alt+Shift+Y on/off · Alt+Shift+P next preset · Alt+Shift+H pick element. Rebind at{' '}
          <code>chrome://extensions/shortcuts</code> (Firefox: about:addons → gear → Manage Extension Shortcuts).
        </p>
      </section>

      <h2 className="section" id="backup">Backup</h2>
      <section className="card">
        <p className="muted">
          Toggles, lists, rules, custom CSS and presets as one JSON file. Version it, diff it, share a rule set. (Remembered speeds are included.)
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={exportJson}>
            Export JSON
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => e.target.files[0] && importJson(e.target.files[0])}
          />
          <button type="button" className="btn btn--danger" onClick={resetAll}>
            Reset everything
          </button>
        </div>
        {status && <p role="status" className={status.ok ? 'ok' : 'warn'}>{status.text}</p>}
      </section>
    </main>
  );
}
