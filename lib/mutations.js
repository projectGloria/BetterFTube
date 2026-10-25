// Changes describe only edited fields. Arrays merge by entry/id, so unrelated
// additions from another tab survive. Full replacement is explicit for imports.
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = v => typeof v === 'string' ? v.toLowerCase() : v.id;
export function settingsChanges(before, after) {
  const changes = [];
  const visit = (a, b, path) => {
    if (equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      changes.push({ path, remove: a.filter(x => !b.some(y => key(y) === key(x))).map(key),
        put: b.filter(x => !a.some(y => key(y) === key(x))),
        edit: b.filter(x => typeof x === 'object' && a.some(y => key(y) === key(x))).map(x => {
          const old = a.find(y => key(y) === key(x));
          return { id: key(x), fields: Object.fromEntries(Object.entries(x).filter(([k, v]) => !equal(old[k], v))) };
        }).filter(x => Object.keys(x.fields).length) });
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
      target[field] = [...items.values()];
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
