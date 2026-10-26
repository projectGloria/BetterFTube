import { parse, walk } from 'css-tree';

export const LIMITS = Object.freeze({ list: 2000, entry: 512, rules: 500, selector: 2048, presets: 20, css: 100_000, importBytes: 2_000_000 });

export function isSafeSelector(sel) {
  if (typeof sel !== 'string' || !sel.trim() || sel.length > LIMITS.selector || /[{};]|\/\*/.test(sel)) return false;
  try {
    const ast = parse(sel, { context: 'selectorList' });
    let safe = true;
    walk(ast, node => { if (node.type === 'Raw') safe = false; });
    return safe;
  } catch { return false; }
}

// For the rule editor. querySelector on an empty fragment asks the browser's
// own selector engine and, unlike CSS.supports('selector(…)'), accepts a full
// selector LIST (`a, b`), which the picker and imports already allow. It
// throws on syntax errors and matches nothing, so it costs no DOM walk.
export function selectorError(sel, doc = globalThis.document) {
  if (!sel.trim()) return 'Empty selector';
  try {
    doc.createDocumentFragment().querySelector(sel);
  } catch {
    return 'Browser can’t parse this selector';
  }
  // Parses in the browser but not in our sanitizer: braces, semicolons,
  // comments, over-long input, or syntax css-tree can't fully model.
  if (!isSafeSelector(sel)) return 'Unsupported selector (no { } ; or comments, max 2,048 characters)';
  return null;
}

export function validateBackup(raw) {
  if (!raw || Array.isArray(raw) || raw.app !== 'betterftube' || raw.schema !== 1 ||
      !raw.features || typeof raw.features !== 'object' || Array.isArray(raw.features)) {
    throw new Error('Choose a BetterFTube backup with schema 1.');
  }
}
