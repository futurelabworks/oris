// Oris highlighter. Injected on demand by the service worker (never on every page):
// - when you highlight a selection (context menu or Alt+Shift+H)
// - when you open a page that already has saved highlights, to paint them again.
// Highlights are found again by their text plus a little text before and after it.
(() => {
  if (window.__orisHL) return;

  const TAG = 'oris-hl';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS']);
  let pageKey = '';
  let subscribed = false;
  let retryTimer = null;

  function ensureStyle() {
    if (document.getElementById('oris-hl-style')) return;
    const style = document.createElement('style');
    style.id = 'oris-hl-style';
    style.textContent = `
      ${TAG} { all: unset; display: inline !important; color: inherit !important; border-radius: 2px !important;
        box-decoration-break: clone !important; -webkit-box-decoration-break: clone !important; cursor: text; }
      ${TAG}[data-color="yellow"] { background: rgba(255, 214, 10, .45) !important; }
      ${TAG}[data-color="green"]  { background: rgba(52, 199, 120, .35) !important; }
      ${TAG}[data-color="blue"]   { background: rgba(96, 140, 255, .32) !important; }
      ${TAG}[data-color="pink"]   { background: rgba(255, 105, 170, .33) !important; }
      ${TAG}.oris-flash { outline: 2px solid rgba(61, 79, 214, .8) !important; outline-offset: 1px; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  // Normalised text of the page (whitespace runs collapsed) with a map back to DOM positions.
  function buildIndex() {
    const chars = [];
    const map = [];
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
          if (p.nodeType === 1 && (SKIP.has(p.nodeName.toUpperCase()) || p.id === 'oris-hl-toast-host')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let lastSpace = true;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.data;
      for (let i = 0; i < data.length; i++) {
        const ch = data[i];
        if (/\s/.test(ch)) {
          if (lastSpace) continue;
          chars.push(' ');
          lastSpace = true;
        } else {
          chars.push(ch);
          lastSpace = false;
        }
        map.push({ node, off: i });
      }
    }
    return { text: chars.join(''), map };
  }

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Wrap normalised range [start, end) in <oris-hl> elements (one per text node).
  function wrap(index, start, end, id, color) {
    const byNode = new Map();
    for (let i = start; i < end; i++) {
      const { node, off } = index.map[i];
      const seg = byNode.get(node);
      if (seg) seg[1] = off + 1;
      else byNode.set(node, [off, off + 1]);
    }
    let first = null;
    for (const [node, [s, e]] of byNode) {
      if (!node.parentNode) continue;
      if (!node.data.slice(s, e).trim()) continue;
      let target = node;
      if (e < target.data.length) target.splitText(e);
      if (s > 0) target = target.splitText(s);
      const mark = document.createElement(TAG);
      mark.dataset.orisId = id;
      mark.dataset.color = color;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      first = first || mark;
    }
    return first;
  }

  function unwrap(id) {
    document.querySelectorAll(`${TAG}[data-oris-id="${CSS.escape(id)}"]`).forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    });
  }

  // Best occurrence of `text`, using the stored prefix/suffix to tell repeats apart.
  function locate(index, h) {
    const needle = norm(h.text);
    if (!needle) return -1;
    const hay = index.text;
    const pre = norm(h.prefix);
    const suf = norm(h.suffix);
    let best = -1;
    let bestScore = -1;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      let score = 0;
      const before = hay.slice(Math.max(0, at - pre.length - 1), at).trim();
      const after = hay.slice(at + needle.length, at + needle.length + suf.length + 1).trim();
      for (let k = 1; k <= pre.length; k++) if (before.endsWith(pre.slice(-k))) score = Math.max(score, k);
      let s2 = 0;
      for (let k = 1; k <= suf.length; k++) if (after.startsWith(suf.slice(0, k))) s2 = k;
      score += s2;
      if (score > bestScore) { bestScore = score; best = at; }
      if (bestScore === pre.length + suf.length) break;
    }
    return best;
  }

  function capture(color, id) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return { error: 'Select some text on the page first.' };
    const range = sel.getRangeAt(0);
    const index = buildIndex();
    let start = -1;
    let end = -1;
    for (let i = 0; i < index.map.length; i++) {
      const { node, off } = index.map[i];
      if (!range.intersectsNode(node)) continue;
      if (node === range.startContainer && off < range.startOffset) continue;
      if (node === range.endContainer && off >= range.endOffset) continue;
      if (start === -1) start = i;
      end = i + 1;
    }
    if (start === -1) return { error: 'That text can’t be highlighted. Try selecting text in the page body.' };
    while (start < end && index.text[start] === ' ') start++;
    while (end > start && index.text[end - 1] === ' ') end--;
    const text = index.text.slice(start, end);
    if (!text) return { error: 'Select some text on the page first.' };
    if (text.length > 5000) return { error: 'That selection is too long. Highlight up to about a page of text.' };
    ensureStyle();
    wrap(index, start, end, id, color);
    sel.removeAllRanges();
    return {
      text,
      prefix: index.text.slice(Math.max(0, start - 32), start),
      suffix: index.text.slice(end, end + 32),
    };
  }

  // Make the page match the saved list: remove deleted marks, recolour, paint missing ones.
  function sync(highlights, attempt = 0) {
    ensureStyle();
    const wanted = new Map(highlights.map((h) => [h.id, h]));
    const present = new Set();
    document.querySelectorAll(`${TAG}[data-oris-id]`).forEach((m) => {
      const h = wanted.get(m.dataset.orisId);
      if (!h) return;
      present.add(h.id);
      if (m.dataset.color !== h.color) m.dataset.color = h.color;
    });
    [...new Set([...document.querySelectorAll(`${TAG}[data-oris-id]`)].map((m) => m.dataset.orisId))]
      .filter((id) => !wanted.has(id))
      .forEach(unwrap);

    let missing = 0;
    for (const h of highlights) {
      if (present.has(h.id)) continue;
      const index = buildIndex();
      const at = locate(index, h);
      if (at === -1) { missing++; continue; }
      wrap(index, at, at + norm(h.text).length, h.id, h.color);
    }
    // Pages that render late (SPAs) get two more tries.
    clearTimeout(retryTimer);
    if (missing && attempt < 2) retryTimer = setTimeout(() => syncFromStorage(attempt + 1), attempt ? 4000 : 1500);
    return { painted: highlights.length - missing, missing };
  }

  async function syncFromStorage(attempt = 0) {
    if (!pageKey) return;
    let data;
    try { data = await chrome.storage.local.get('research'); } catch { return; }
    const sources = (data.research && data.research.sources) || [];
    const list = sources.filter((s) => s.urlKey === pageKey).flatMap((s) => s.highlights || []);
    sync(list, attempt);
  }

  function init(key) {
    pageKey = key;
    if (subscribed) return;
    subscribed = true;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.research) syncFromStorage();
      });
    } catch { /* extension reloaded */ }
  }

  function scrollTo(id) {
    const marks = document.querySelectorAll(`${TAG}[data-oris-id="${CSS.escape(id)}"]`);
    if (!marks.length) return false;
    marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    marks.forEach((m) => m.classList.add('oris-flash'));
    setTimeout(() => marks.forEach((m) => m.classList.remove('oris-flash')), 1600);
    return true;
  }

  function toast(message, isError) {
    let host = document.getElementById('oris-hl-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'oris-hl-toast-host';
      host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;';
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    const box = document.createElement('div');
    box.textContent = message;
    box.style.cssText = `font: 500 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff;
      background: ${isError ? '#b4431a' : '#3d4fd6'}; padding: 10px 14px; border-radius: 10px; margin-top: 8px;
      box-shadow: 0 8px 24px rgba(10, 14, 30, .25); max-width: 320px;`;
    host.shadowRoot.appendChild(box);
    setTimeout(() => box.remove(), isError ? 4000 : 2500);
  }

  window.__orisHL = { capture, sync, syncFromStorage, init, scrollTo, toast, unwrap };
})();
