import { useState } from 'react';
import { isSafeSelector, newId } from '../../lib/settings.js';

// CSS.supports('selector(…)') asks the CSS parser itself, i.e. exactly what
// the injected stylesheet will accept, without touching the DOM.
export function selectorError(sel) {
  if (!sel.trim()) return 'Empty selector';
  if (!isSafeSelector(sel)) return 'Selectors can’t contain { } ; or comments';
  if (!CSS.supports(`selector(${sel})`)) return 'Browser can’t parse this selector';
  return null;
}

export function RulesEditor({ rules, onChange }) {
  const [label, setLabel] = useState('');
  const [selector, setSelector] = useState('');
  const error = selector ? selectorError(selector) : null;

  const patch = (id, fields) => onChange(rules => rules.map((r) => (r.id === id ? { ...r, ...fields } : r)));

  const add = async (e) => {
    e.preventDefault(); // it's a <form>: Enter submits, but no page reload
    if (!selector || error) return;
    if (rules.length >= 500) return;
    const ok = await onChange(rules => [...rules, { id: newId(), label: label.trim() || selector.trim(), selector: selector.trim(), enabled: true }]);
    if (ok === false) return;
    setLabel('');
    setSelector('');
  };

  return (
    <section className="card">
      <header className="card__head">
        <h2>Custom hide rules</h2>
        <span className="muted">
          {rules.length} rule{rules.length === 1 ? '' : 's'}
        </span>
      </header>
      <p className="muted">
        Each rule hides everything matching a CSS selector and shows up as a toggle in the popup's Custom group.
        Easiest way to make one: popup → Custom → <b>Pick element to hide</b> (or Alt+Shift+H on YouTube).
      </p>

      {rules.length > 0 && (
        <ul className="rules">
          {rules.map((r) => (
            <li key={r.id} className="rule">
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={r.enabled}
                aria-label={`Enable ${r.label}`}
                onChange={(e) => patch(r.id, { enabled: e.target.checked })}
              />
              <span className="rule__text">
                {/* key = label: remounts (resets defaultValue) if the label
                    changes from outside, e.g. an import. Uncontrolled + commit
                    on blur keeps every keystroke out of storage. */}
                <input
                  key={r.label}
                  className="rule__label"
                  aria-label="Rule name"
                  defaultValue={r.label}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== r.label && patch(r.id, { label: e.target.value.trim() })}
                />
                <code className="rule__sel">{r.selector}</code>
              </span>
              <button type="button" className="btn btn--small btn--danger" onClick={() => onChange(rules => rules.filter((x) => x.id !== r.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="rule-add" onSubmit={add}>
        <input className="input" aria-label="New rule name" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          className="input input--mono"
          aria-label="CSS selector"
          placeholder="CSS selector, e.g. ytd-merch-shelf-renderer"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={rules.length >= 500 || !selector || Boolean(error)}>
          Add
        </button>
      </form>
      {rules.length >= 500 && <p role="status">Rule limit reached (500).</p>}
      {error && <p className="warn">{error}</p>}
    </section>
  );
}
