import { memo } from 'react';

// Diagnostics badge: how many elements this feature's selectors match on the
// active tab. undefined = no data (not a YouTube tab / JS-only feature).
export function Badge({ value }) {
  if (value === undefined) return null;
  if (value === 'invalid')
    return (
      <span className="badge badge--error" title="Selector this browser can't parse">
        !
      </span>
    );
  return (
    <span className={value ? 'badge' : 'badge badge--zero'} title="Matches on this page">
      {value}
    </span>
  );
}

// memo: flipping one toggle replaces `settings`, which re-renders App. Without
// memo every row re-renders too. Props here are primitives + a stable `onChange`
// (useCallback in App), so memo's shallow compare actually short-circuits.
// Pass an inline arrow as onChange and this memo becomes dead weight.
export const Toggle = memo(function Toggle({ id, label, hint, badge, checked, disabled, onChange }) {
  return (
    <label className="toggle" data-disabled={disabled || undefined}>
      <span className="toggle__text">
        <span className="toggle__label">
          {label} <Badge value={badge} />
        </span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(id, e.target.checked)}
      />
    </label>
  );
});
