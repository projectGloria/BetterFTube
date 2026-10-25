import { useId, useState } from 'react';

// Textarea editor for a value that lives in the external store. Default
// format/parse handle a string[] (one per line); pass identity functions to
// edit a plain string (custom CSS).
//
// Pattern: DERIVED draft, not synced draft. `edit` is null while untouched, so
// the textarea shows the live store value, and a channel added via right-click
// while this page is open shows up immediately. The common alternative,
// useState(initial) + useEffect(() => setDraft(value), [value]), double-renders
// and silently clobbers whatever you were typing when the store changes.
const joinLines = (v) => v.join('\n');
const splitLines = (t) => t.split('\n');

export function ListEditor({
  title,
  help,
  placeholder,
  value,
  onSave,
  validate,
  format = joinLines,
  parse = splitLines,
  countLabel = (v) => `${v.length} entries`,
}) {
  // { text, base }: base = store value when editing started, to detect
  // concurrent external changes instead of silently overwriting them.
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const current = format(value);
  const text = edit?.text ?? current;
  const dirty = edit !== null && edit.text !== current;
  const conflict = edit !== null && edit.base !== current;
  const problems = validate?.(parse(text)) ?? [];

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ok = await onSave(parse(text));
      if (ok !== false) setEdit(current => current?.text === text ? null : current);
    } finally { setSaving(false); }
  };

  return (
    <section className="card">
      <header className="card__head">
        <h2 id={labelId}>{title}</h2>
        <span className="muted">{countLabel(value)}</span>
      </header>
      <p className="muted">{help}</p>
      <textarea
        className="textarea"
        aria-labelledby={labelId}
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setEdit({ text: e.target.value, base: edit?.base ?? current })}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault(); // otherwise Chrome opens "Save page as…"
            if (dirty) save();
          }
        }}
      />
      {problems.length > 0 && (
        <p className="warn">Ignored (invalid, unsupported or over limit): {problems.join(', ')}</p>
      )}
      {conflict && <p className="warn">Changed elsewhere since you started editing. Saving overwrites it.</p>}
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={!dirty || saving} onClick={save}>
          Save
        </button>
        {edit !== null && (
          <button type="button" className="btn" onClick={() => setEdit(null)}>
            Revert
          </button>
        )}
        <span className="muted small">Ctrl+S to save</span>
      </div>
    </section>
  );
}
