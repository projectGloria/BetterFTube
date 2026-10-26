// Changes describe only edited fields. Arrays merge by entry/id, so unrelated
// additions from another tab survive. Full replacement is explicit for imports.
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = v => typeof v === 'string' ? v.toLowerCase() : v.id;
export function settingsChanges(before, after) {
  const changes = [];
  const visit = (a, b, path) => {
    if (equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      // Maps, not nested .some(): lists hold up to 2,000 entries.
      const before = new Map(a.map(x => [key(x), x]));
      const after = new Map(b.map(x => [key(x), x]));
      const change = { path, remove: [...before.keys()].filter(k => !after.has(k)),
        // A string whose spelling changed under the same case-insensitive key
        // ("@foo" → "@Foo") is a put; applyChanges replaces it in place. Before,
        // it produced no change at all and the save was a silent no-op.
        put: b.filter(x => typeof x === 'string' ? before.get(key(x)) !== x : !before.has(key(x))),
        edit: b.filter(x => typeof x === 'object' && before.has(key(x))).map(x => {
          const old = before.get(key(x));
          return { id: key(x), fields: Object.fromEntries(Object.entries(x).filter(([k, v]) => !equal(old[k], v))) };
        }).filter(x => Object.keys(x.fields).length) };
      // Reordering surviving entries is a change too (it used to vanish).
      const kept = b.map(key).filter(k => before.has(k));
      if (!equal(kept, [...before.keys()].filter(k => after.has(k)))) change.order = b.map(key);
      changes.push(change);
    } else if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of Object.keys(b)) visit(a[k], b[k], [...path, k]);
    } else changes.push({ path, value: b });
  };
  visit(before, after, []);
  return changes;
}

export function applyChanges(settings, changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw new Error('Invalid settings changes');
  const result = structuredClone(settings);
  for (const c of changes) {
    if (!Array.isArray(c.path) || !c.path.length || c.path.some(k => typeof k !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('Invalid settings path');
    let target = result;
    for (const part of c.path.slice(0, -1)) {
      if (!Object.hasOwn(target, part) || !target[part] || Array.isArray(target[part])) throw new Error('Invalid settings path');
      target = target[part];
    }
    const field = c.path.at(-1);
    if (!Object.hasOwn(target, field)) throw new Error('Unknown setting');
    if (Array.isArray(target[field])) {
      if (!Array.isArray(c.remove) || !Array.isArray(c.put)) throw new Error('Invalid list change');
      const items = new Map(target[field].map(v => [key(v), v]));
      for (const id of c.remove) items.delete(id);
      for (const item of c.put) items.set(key(item), item);
      for (const edit of c.edit ?? []) {
        if (items.has(edit.id)) items.set(edit.id, { ...items.get(edit.id), ...edit.fields, id: edit.id });
      }
      let values = [...items.values()];
      if (c.order !== undefined) {
        if (!Array.isArray(c.order) || c.order.length > 5000) throw new Error('Invalid list order');
        const rank = new Map(c.order.map((k, i) => [k, i]));
        // Entries the sender never saw (added in another tab meanwhile) keep
        // their relative order after the ones it ranked.
        values = values.map((v, i) => [v, rank.get(key(v)) ?? c.order.length + i])
          .sort((x, y) => x[1] - y[1]).map(([v]) => v);
      }
      target[field] = values;
    } else target[field] = c.value;
  }
  return result;
}

export function serialQueue() {
  let tail = Promise.resolve();
  return fn => {
    const job = tail.then(fn);
    tail = job.catch(() => {});
    return job;
  };
}
