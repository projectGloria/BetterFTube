import { memo } from 'react';
import { Badge } from './Toggle.jsx';

// Same contract as Toggle (id + value + stable onChange) so App can render
// either from the feature list without branching on props, only on type.
export const Select = memo(function Select({ id, label, hint, badge, value, options, disabled, onChange }) {
  return (
    <label className="toggle" data-disabled={disabled || undefined}>
      <span className="toggle__text">
        <span className="toggle__label">
          {label} <Badge value={badge} />
        </span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
      <select
        className="select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(id, e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
});
