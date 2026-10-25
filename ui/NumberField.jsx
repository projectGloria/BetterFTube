import { memo, useState } from 'react';
import { Badge } from './Toggle.jsx';

// Number setting where 0 = off. Same derived-draft pattern as ListEditor:
// `draft` is null unless you're typing, so the field shows the live store value
// otherwise. Commits on blur/Enter only. Writing on every keystroke would push
// "1", "12", "120" through storage and rescan the feed in every open tab 3 times.
export const NumberField = memo(function NumberField({ id, label, hint, badge, unit, min, max, step, value, disabled, onChange }) {
  const [draft, setDraft] = useState(null);

  const commit = () => {
    if (draft === null) return;
    const n = draft.trim() === '' ? 0 : Number(draft);
    // Invalid input reverts instead of saving NaN; range clamping happens in
    // normalize(), the single place that enforces it.
    if (Number.isFinite(n)) onChange(id, Math.min(max, Math.max(min, n)));
    setDraft(null);
  };

  return (
    <label className="toggle" data-disabled={disabled || undefined}>
      <span className="toggle__text">
        <span className="toggle__label">
          {label} <Badge value={badge} />
        </span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
      <span className="number">
        <input
          type="number"
          inputMode="numeric"
          className="number__input"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          // Show blank instead of "0" for off: reads as "not set", and typing
          // doesn't start with a stray leading zero.
          value={draft ?? (value > 0 ? String(value) : '')}
          placeholder="off"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur(); // blur → commit, one code path
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        <span className="number__unit">{unit}</span>
      </span>
    </label>
  );
});
