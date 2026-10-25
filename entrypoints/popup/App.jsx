import { useCallback, useState } from 'react';
import { browser } from 'wxt/browser';
import { FEATURES, GROUPS, isActiveValue } from '../../lib/features.js';
import { applyPreset } from '../../lib/presets.js';
import { DEFAULTS, newId } from '../../lib/settings.js';
import { NumberField } from '../../ui/NumberField.jsx';
import { PresetBar } from '../../ui/PresetBar.jsx';
import { Select } from '../../ui/Select.jsx';
import { Toggle } from '../../ui/Toggle.jsx';
import { badgeFor, useDiagnostics } from '../../ui/useDiagnostics.js';
import { usePermissions } from '../../ui/usePermissions.js';
import { useSettings } from '../../ui/useSettings.js';

// Grouping is derived once at module load: FEATURES is static, so doing this
// inside render (or a useMemo) would just be ceremony.
const featuresByGroup = GROUPS.map((g) => ({
  ...g,
  features: FEATURES.filter((f) => f.group === g.id),
}));
const FEATURE_BY_ID = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
const ALL_ORIGINS = [...new Set(FEATURES.flatMap((f) => f.origins ?? []))];

// Which groups are expanded: a per-browser UI convenience, so plain localStorage
// (sync, no flicker) rather than extension storage. try/catch because storage
// access can throw (disabled site data), and a popup that crashes over a
// collapse state would be a silly way to lose all your toggles.
const OPEN_KEY = 'bft:open-groups';
function readOpenGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY));
    if (Array.isArray(v)) return new Set(v);
  } catch {}
  return new Set(['feed']); // first run: only Feed expanded
}

async function pickElement() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  await browser.tabs.sendMessage(tab.id, { type: 'bft:pick' }, { frameId: 0 }).catch(() => null);
  window.close(); // the picker lives in the page; the popup would cover it
}

// One control per feature type. Picking the component by type keeps App free
// of per-type prop juggling.
function FeatureControl({ f, settings, diag, onChange }) {
  const common = {
    id: f.id,
    label: f.label,
    hint: f.hint,
    badge: badgeFor(diag, f),
    disabled: !settings.enabled,
    onChange,
  };
  const value = settings.features[f.id];
  if (f.type === 'select') return <Select {...common} value={value} options={f.options} />;
  if (f.type === 'number')
    return <NumberField {...common} value={value} unit={f.unit} min={f.min} max={f.max} step={f.step} />;
  return <Toggle {...common} checked={value} />;
}

export default function App() {
  const [settings, update, saveError] = useSettings();
  const [permissionError, setPermissionError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const diag = useDiagnostics();
  const granted = usePermissions(ALL_ORIGINS);
  // Lazy initializer: readOpenGroups runs once on mount, not on every render.
  const [openGroups, setOpenGroups] = useState(readOpenGroups);

  // Stable identity across renders (update is stable too), so memo'd rows skip.
  const setFeature = useCallback(
    async (id, value) => {
      const f = FEATURE_BY_ID[id];
      setPermissionError('');
      // Persist intent even if the native permission prompt closes the popup.
      // Background permission events retry open videos, and all requests still
      // require both the saved setting and the actual grant.
      const saved = update(s => ({ ...s, features: { ...s.features, [id]: value } }));
      if (!f?.origins || !isActiveValue(value)) { await saved; return; }
      try {
        const ok = await browser.permissions.request({ origins: f.origins });
        await saved;
        if (!ok) {
          await update(s => ({ ...s, features: { ...s.features, [id]: f.default } }));
          setPermissionError('Access denied. The feature is off.');
        }
      } catch (err) {
        await saved;
        await update(s => ({ ...s, features: { ...s.features, [id]: f.default } }));
        setPermissionError(`Could not enable feature: ${err.message}`);
      }
    },
    [update],
  );
  const setRule = useCallback(
    (id, enabled) =>
      update((s) => ({
        ...s,
        custom: { ...s.custom, rules: s.custom.rules.map((r) => (`rule:${r.id}` === id ? { ...r, enabled } : r)) },
      })),
    [update],
  );
  const setEnabled = useCallback((enabled) => update((s) => ({ ...s, enabled })), [update]);
  const onApplyPreset = useCallback((p) => update((s) => applyPreset(s, p)), [update]);
  const onSavePreset = useCallback(
    (name) => update(s => {
      if (s.presets.length >= 20) throw new Error('Preset limit reached (20)');
      return { ...s, presets: [...s.presets, { id: `user:${newId()}`, name, features: s.features }] };
    }),
    [update],
  );
  // Reset toggles only; wiping someone's hand-built blocklist or rules from a
  // one-click popup link would be hostile. Full reset lives in Options.
  const reset = useCallback(() => update((s) => ({ ...s, features: DEFAULTS.features })), [update]);

  const toggleGroup = (id, open) => {
    setOpenGroups((prev) => {
      // <details> fires `toggle` on initial render too when open is set; bail
      // out on no-op to avoid a pointless state update + localStorage write.
      if (prev.has(id) === open) return prev;
      const next = new Set(prev);
      open ? next.add(id) : next.delete(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  // First render before storage resolves (~1 frame). Render nothing rather
  // than defaults, otherwise the switches visibly jump to the real state.
  if (!settings) return <p role="status">{saveError || 'Loading settings...'}</p>;

  const activeCount = FEATURES.filter((f) => isActiveValue(settings.features[f.id])).length;
  // Enabled network features whose host permission is missing
  const ungranted = FEATURES.filter(
    (f) => f.origins && isActiveValue(settings.features[f.id]) && !f.origins.every((o) => granted.has(o)),
  );

  return (
    <main className="popup">
      <header className="header">
        <h1 className="title">
          Better<span>F</span>Tube
        </h1>
        <input
          type="checkbox"
          role="switch"
          className="switch switch--master"
          aria-label="Enable BetterFTube"
          checked={settings.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </header>

      <PresetBar settings={settings} onApply={onApplyPreset} onSave={onSavePreset} />

      {(saveError || permissionError) && <p role="alert" className="warn">{saveError || permissionError}</p>}
      <div className="toolbar">
        <input className="input" aria-label="Search settings" placeholder="Search settings" value={search} onChange={e => setSearch(e.target.value)} />
        <label><input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} /> Enabled only</label>
        <label><input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} /> Selector diagnostics</label>
      </div>
      {diag && <div className="diag-note">
        <p>Hidden by blocklist: {diag.hidden?.blocklist ?? 0}; filters: {diag.hidden?.filters ?? 0}. A tile can match both.</p>
        <button className="btn btn--small" onClick={async () => {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.id != null) browser.tabs.sendMessage(tab.id, { type: 'bft:reveal' }).catch(() => {});
        }}>Reveal blocked / filtered tiles for 15s</button>
        <p>Views and age filters support English text. Unreadable statistics stay visible. Page language: {diag.language}.</p>
        {advanced && <p>Numbers count selector matches, not hidden videos. Zero can mean no matching content on this page.</p>}
      </div>}

      {featuresByGroup.map((group) => {
        const matches = (label, value) => (!onlyActive || isActiveValue(value)) && label.toLowerCase().includes(search.toLowerCase());
        const visibleFeatures = group.features.filter(f => matches(`${f.label} ${f.hint || ''}`, settings.features[f.id]));
        const rules = group.id === 'custom' ? settings.custom.rules.filter(r => matches(r.label, r.enabled)) : [];
        if (!visibleFeatures.length && !rules.length && (search || onlyActive)) return null;
        const on =
          group.features.filter((f) => isActiveValue(settings.features[f.id])).length +
          rules.filter((r) => r.enabled).length;
        return (
          <details
            key={group.id}
            className="group"
            open={Boolean(search) || onlyActive || openGroups.has(group.id)}
            onToggle={(e) => toggleGroup(group.id, e.currentTarget.open)}
          >
            <summary className="group__title">
              {group.label}
              <span className="group__count">
                {on}/{group.features.length + rules.length}
              </span>
            </summary>
            {visibleFeatures.map((f) => (
              <FeatureControl key={f.id} f={f} settings={settings} diag={advanced ? diag : null} onChange={setFeature} />
            ))}
            {rules.map((r) => (
              <Toggle
                key={r.id}
                id={`rule:${r.id}`}
                label={r.label}
                hint={r.selector}
                badge={advanced && diag ? (diag.invalid.includes(`rule:${r.id}`) ? 'invalid' : diag.counts[`rule:${r.id}`]) : undefined}
                checked={r.enabled}
                disabled={!settings.enabled}
                onChange={setRule}
              />
            ))}
            {group.id === 'custom' && (
              <div className="group__actions">
                <button type="button" className="btn btn--small" onClick={pickElement} disabled={!diag}>
                  Pick element to hide
                </button>
                {!diag && <span className="muted small">Open on a YouTube tab</span>}
              </div>
            )}
            {group.id === 'network' && diag?.online && <p className="diag-note" role="status">SponsorBlock: {diag.online.sponsorblock}. Dislikes: {diag.online.dislikes}.</p>}
            {group.id === 'network' && ungranted.length > 0 && (
              <div className="group__actions">
                <span className="warn small">Access not granted: {ungranted.map((f) => f.label).join(', ')}</span>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => browser.permissions.request({ origins: ungranted.flatMap(f => f.origins) }).then(ok => setPermissionError(ok ? '' : 'Access denied.')).catch(err => setPermissionError(err.message))}
                >
                  Grant
                </button>
              </div>
            )}
          </details>
        );
      })}

      <footer className="footer">
        <span>{settings.enabled ? `${activeCount}/${FEATURES.length} active` : 'Paused'}</span>
        <span className="footer__links">
          <button type="button" className="link" onClick={() => browser.runtime.openOptionsPage()}>
            Options
          </button>
          <button type="button" className="link" onClick={reset}>
            Reset
          </button>
        </span>
      </footer>
    </main>
  );
}
