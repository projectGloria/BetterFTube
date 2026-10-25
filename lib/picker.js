// Click-to-hide element picker (isolated world).
//
// Flow: hover highlights the nearest YouTube component → click locks it →
// panel offers selector candidates from narrow to broad, each with a live match
// count and preview highlight → "Hide" saves it as a custom rule.

// Attributes YouTube uses as stable state flags. Ids/classes are mostly
// generated or shared, so they're not trusted beyond `#id` on custom elements.
const KEEP_ATTRS = ['is-shorts', 'overlay-style', 'page-subtype', 'tab-title', 'target-id', 'aria-label'];
const MAX_PREVIEW = 150; // highlight boxes; drawing 2000 divs on a feed would stutter

const isCustom = (el) => el.localName.includes('-');

// Nearest custom element (ytd-*, yt-*, …) at or above `el`. Those tag names are
// YouTube's component boundaries and survive redesigns far better than divs.
export function anchorOf(el) {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    if (isCustom(n)) return n;
  }
  return el;
}

const attrQualifiers = (el) =>
  KEEP_ATTRS.filter((a) => el.hasAttribute(a))
    .map((a) => {
      const v = el.getAttribute(a);
      return v === '' ? `[${a}]` : `[${a}="${CSS.escape(v)}"]`;
    })
    .join('');

// Generated ids (lots of digits) change per render; meaningful ones (#comments,
// #related, #chat) are worth keeping.
const idQualifier = (el) => (el.id && !/\d{3,}/.test(el.id) ? `#${CSS.escape(el.id)}` : '');

function count(selector) {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

// Narrow → broad. Each must match at least the target itself to be offered.
export function selectorCandidates(el) {
  const tag = el.localName;
  const own = `${tag}${idQualifier(el)}${attrQualifiers(el)}`;
  const parent = el.parentElement && anchorOf(el.parentElement);
  const raw = [
    parent && parent !== el && isCustom(parent) ? `${parent.localName}${idQualifier(parent)} ${own}` : null,
    own,
    `${tag}${attrQualifiers(el)}`,
    tag,
  ];
  const out = [];
  for (const selector of raw) {
    if (!selector || out.some((c) => c.selector === selector)) continue;
    let hit = false;
    try {
      hit = el.matches(selector);
    } catch {}
    if (hit) out.push({ selector, count: count(selector) });
  }
  return out;
}

function defaultLabel(el) {
  const snippet = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return snippet ? `${el.localName}: ${snippet}` : el.localName;
}

const STYLE = `
  :host { all: initial; }
  .box { position: fixed; pointer-events: none; z-index: 2147483646;
         border: 2px solid #ff3b3b; background: rgb(255 59 59 / .15); border-radius: 3px; }
  .box.hover { border-style: dashed; background: rgb(255 59 59 / .08); }
  .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 380px;
           background: #18181b; color: #ececee; border: 1px solid #3f3f46; border-radius: 10px;
           padding: 14px; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 8px 32px #000a; }
  .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
          background: #18181b; color: #ececee; border: 1px solid #3f3f46; border-radius: 8px;
          padding: 8px 14px; font: 13px system-ui, sans-serif; pointer-events: none; }
  h3 { margin: 0 0 8px; font-size: 14px; }
  label.c { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; cursor: pointer; }
  code { font: 12px ui-monospace, Consolas, monospace; word-break: break-all; flex: 1; }
  .n { color: #8b8b93; font-size: 11px; white-space: nowrap; }
  input[type=text] { width: 100%; box-sizing: border-box; margin: 8px 0; padding: 6px 8px;
         background: #0f0f10; color: #ececee; border: 1px solid #3f3f46; border-radius: 6px; font: inherit; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  button { background: #3f3f46; color: #ececee; border: 1px solid #3f3f46; border-radius: 6px;
           padding: 5px 10px; font: inherit; cursor: pointer; }
  button.primary { background: #c82020; border-color: #c82020; color: #fff; }
`;

let active = null; // the running picker, so a second start is a no-op

// onSave({ selector, label }) persists the rule; picker closes itself after.
export function startPicker({ onSave }) {
  if (active) return;

  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.tabIndex = -1;
  host.setAttribute('aria-label', 'Element picker. Use Up and Down to choose, Enter to select, Escape to cancel.');
  host.id = 'bft-picker';
  // Open shadow root: isolates our styles from YouTube's (and theirs from ours),
  // and stays reachable for tests. Closed mode buys no real security here.
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style><div class="boxes"></div><div class="hint" role="status" aria-live="polite">Click an element or use Up/Down then Enter · Esc to cancel</div>`;
  document.documentElement.append(host);
  host.focus();
  const boxes = shadow.querySelector('.boxes');

  let hovered = null;
  let target = null; // locked element
  let candidates = [];
  let selected = 0;
  let panel = null;

  const drawBoxes = (els, cls = '') => {
    boxes.replaceChildren(
      ...els.slice(0, MAX_PREVIEW).map((el) => {
        const r = el.getBoundingClientRect();
        const b = document.createElement('div');
        b.className = `box ${cls}`;
        Object.assign(b.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        return b;
      }),
    );
  };

  const preview = () => {
    if (!target) return hovered && drawBoxes([hovered], 'hover');
    const sel = candidates[selected]?.selector;
    drawBoxes(sel ? [...document.querySelectorAll(sel)] : [target]);
  };

  const inPicker = (e) => e.composedPath().includes(host);

  const renderPanel = () => {
    panel?.remove();
    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Hide element');
    panel.innerHTML = `<h3>Hide element</h3><div class="cands"></div>
      <input type="text" class="label" aria-label="Rule name" placeholder="Label shown in the popup">
      <div class="row">
        <button class="parent" title="Select the enclosing component">↑ Parent</button>
        <button class="repick">Re-pick</button>
        <button class="cancel">Cancel</button>
        <button class="primary save">Hide</button>
      </div>`;
    const list = panel.querySelector('.cands');
    candidates.forEach((c, i) => {
      // Built with DOM APIs, not innerHTML: selectors contain user-page attribute values.
      const row = document.createElement('label');
      row.className = 'c';
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'c', checked: i === selected });
      radio.addEventListener('change', () => {
        selected = i;
        preview();
      });
      const code = Object.assign(document.createElement('code'), { textContent: c.selector });
      const n = Object.assign(document.createElement('span'), {
        className: 'n',
        textContent: `${c.count} match${c.count === 1 ? '' : 'es'}`,
      });
      row.append(radio, code, n);
      list.append(row);
    });
    const label = panel.querySelector('.label');
    label.value = defaultLabel(target);
    panel.querySelector('.parent').addEventListener('click', () => {
      const up = target.parentElement && anchorOf(target.parentElement);
      if (up && up !== document.body && up !== target) lock(up);
    });
    panel.querySelector('.repick').addEventListener('click', unlock);
    panel.querySelector('.cancel').addEventListener('click', stop);
    panel.querySelector('.save').addEventListener('click', async () => {
      const button = panel.querySelector('.save');
      const selector = candidates[selected]?.selector;
      if (!selector) return;
      button.disabled = true;
      try { await onSave({ selector, label: label.value.trim() || selector }); stop(); }
      catch (err) {
        button.disabled = false;
        let status = panel.querySelector('[role=alert]');
        if (!status) { status = document.createElement('p'); status.setAttribute('role', 'alert'); panel.append(status); }
        status.textContent = `Could not save rule: ${err.message}`;
      }
    });
    shadow.append(panel);
    panel.querySelector('input')?.focus();
    shadow.querySelector('.hint').hidden = true;
  };

  function lock(el) {
    target = el;
    candidates = selectorCandidates(el);
    selected = 0;
    renderPanel();
    preview();
  }

  function unlock() {
    target = null;
    panel?.remove();
    panel = null;
    shadow.querySelector('.hint').hidden = false;
    boxes.replaceChildren();
  }

  // Capture phase on window: runs before ANY YouTube handler, so the pick-click
  // can't also open a video, toggle the player, etc.
  const onMove = (e) => {
    if (target || inPicker(e)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    hovered = anchorOf(el);
    preview();
  };
  const swallow = (e) => {
    if (inPicker(e)) return; // let our own panel work
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onClick = (e) => {
    if (inPicker(e)) return;
    swallow(e);
    if (!target && hovered) lock(hovered);
  };
  const onKey = (e) => {
    if (panel && e.key === 'Tab') {
      const items = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const index = items.indexOf(shadow.activeElement);
      e.preventDefault(); e.stopImmediatePropagation();
      items[(index + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      return;
    }
    if (!target && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Enter') { if (hovered) lock(hovered); return; }
      const choices = [...document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, yt-lockup-view-model, ytd-comments, ytd-watch-metadata, ytd-guide-entry-renderer')].filter(el => el.getClientRects().length);
      if (choices.length) {
        const index = choices.indexOf(hovered);
        hovered = choices[(index + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length];
        hovered.scrollIntoView({ block: 'center' }); preview();
        shadow.querySelector('.hint').textContent = `Selected ${defaultLabel(hovered)}. Enter to choose; Up/Down to move; Escape to cancel.`;
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // YouTube uses Esc too (exit fullscreen, close menus)
      stop();
    }
  };
  const onScroll = () => preview(); // boxes are position:fixed, so re-measure

  const SWALLOWED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu'];
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  for (const t of SWALLOWED) window.addEventListener(t, swallow, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  function stop() {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    for (const t of SWALLOWED) window.removeEventListener(t, swallow, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, { capture: true });
    host.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    active = null;
  }

  active = { stop };
}
