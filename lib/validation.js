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

export function validateBackup(raw) {
  if (!raw || Array.isArray(raw) || raw.app !== 'betterftube' || raw.schema !== 1 ||
      !raw.features || typeof raw.features !== 'object' || Array.isArray(raw.features)) {
    throw new Error('Choose a BetterFTube backup with schema 1.');
  }
}
