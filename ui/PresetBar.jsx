import { useRef, useState } from 'react';
import { activePreset, allPresets } from '../lib/presets.js';

// Chips for every preset; the one matching the current toggles is highlighted.
// "Active" is DERIVED by comparing features, never stored: toggle one switch
// by hand and the highlight correctly drops, with no "activePresetId" state
// to keep in sync (and inevitably get out of sync).
export function PresetBar({ settings, onApply, onSave }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const active = activePreset(settings);
  const saving = useRef(false);

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    const ok = !name.trim() || await onSave(name.trim());
    saving.current = false;
    if (ok === false) return;
    setNaming(false);
    setName('');
  };

  return (
    <div className="presets">
      {allPresets(settings).map((p) => (
        <button
          key={p.id}
          type="button"
          className={p.id === active?.id ? 'chip chip--active' : 'chip'}
          aria-pressed={p.id === active?.id}
          onClick={() => onApply(p)}
        >
          {p.name}
        </button>
      ))}
      {naming ? (
        <input
          className="chip chip--input"
          autoFocus
          maxLength={40}
          aria-label="Preset name"
          placeholder="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setNaming(false);
          }}
        />
      ) : (
        // Saving a state that already IS a preset would just make a duplicate
        !active && settings.presets.length < 20 && (
          <button type="button" className="chip chip--add" onClick={() => setNaming(true)} title="Save current toggles as a preset">
            + Save
          </button>
        )
      )}
    </div>
  );
}
