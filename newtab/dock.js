// Mini-app dock on the New Tab page: calculator, stopwatch and pinned links.
import { DOCK_APPS } from '../lib/planner.js';
import { evaluate, formatResult } from '../lib/calc.js';

const SW_KEY = 'ui:stopwatch';

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const pad = (n) => String(n).padStart(2, '0');
function fmtWatch(ms) {
  const cs = Math.floor(ms / 10) % 100;
  const s = Math.floor(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(cs)}`;
}

export function mountDock({ root, toast, plannerOp, getPlanner }) {
  let openApp = null; // 'calc' | 'stopwatch' | 'edit'
  let calcText = '';
  const history = [];
  let sw = { running: false, startedAt: 0, elapsed: 0, laps: [] };
  let swTimer = null;

  chrome.storage.local.get(SW_KEY).then((r) => { if (r[SW_KEY]) { sw = { ...sw, ...r[SW_KEY] }; render(); } });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c[SW_KEY] && c[SW_KEY].newValue) { sw = { ...sw, ...c[SW_KEY].newValue }; if (openApp === 'stopwatch') render(); }
  });
  const saveSw = () => chrome.storage.local.set({ [SW_KEY]: sw });
  const swNow = () => sw.elapsed + (sw.running ? Date.now() - sw.startedAt : 0);

  function calcPanel() {
    let result = '';
    let error = '';
    if (calcText.trim()) {
      try { result = formatResult(evaluate(calcText)); } catch (e) { error = e.message; }
    }
    const out = h('p', { class: `calc-out${error ? ' err' : ''}`, 'aria-live': 'polite' }, error || (result ? `= ${result}` : 'Try 2400*18% or sqrt(144)'));
    const input = h('input', {
      class: 'text-input calc-in', type: 'text', value: calcText, 'aria-label': 'Calculation', spellcheck: 'false', autocomplete: 'off',
      oninput: (e) => {
        calcText = e.target.value;
        try { out.textContent = calcText.trim() ? `= ${formatResult(evaluate(calcText))}` : 'Try 2400*18% or sqrt(144)'; out.className = 'calc-out'; } catch (err) { out.textContent = err.message; out.className = 'calc-out err'; }
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          try {
            const v = formatResult(evaluate(calcText));
            history.unshift(`${calcText} = ${v}`);
            history.splice(5);
            calcText = v.replace(/,/g, '');
            render();
          } catch { /* message already shown */ }
        }
        if (e.key === 'Escape') { openApp = null; render(); }
      },
    });
    setTimeout(() => input.focus(), 0);
    return h('div', { class: 'dock-pop', role: 'dialog', 'aria-label': 'Calculator' },
      h('p', { class: 'dock-title' }, 'Calculator'),
      input, out,
      history.length ? h('ul', { class: 'calc-hist' }, ...history.map((x) => h('li', {}, x))) : null,
      h('p', { class: 'hint' }, 'Enter keeps the result. Trig uses degrees.'));
  }

  function stopwatchPanel() {
    const time = h('p', { class: 'sw-time', role: 'timer' }, fmtWatch(swNow()));
    clearInterval(swTimer);
    if (sw.running) swTimer = setInterval(() => { time.textContent = fmtWatch(swNow()); }, 50);
    const btn = (label, fn, cls = '') => h('button', { class: `btn small ${cls}`, onclick: fn }, label);
    return h('div', { class: 'dock-pop', role: 'dialog', 'aria-label': 'Stopwatch' },
      h('p', { class: 'dock-title' }, 'Stopwatch'),
      time,
      h('div', { class: 'row' },
        sw.running
          ? btn('Pause', () => { sw.elapsed = swNow(); sw.running = false; saveSw(); render(); }, 'primary')
          : btn(sw.elapsed ? 'Resume' : 'Start', () => { sw.startedAt = Date.now(); sw.running = true; saveSw(); render(); }, 'primary'),
        btn('Lap', () => { sw.laps = [swNow(), ...sw.laps].slice(0, 20); saveSw(); render(); }),
        btn('Reset', () => { sw = { running: false, startedAt: 0, elapsed: 0, laps: [] }; saveSw(); render(); }, 'ghost')),
      sw.laps.length ? h('ol', { class: 'sw-laps', reversed: true }, ...sw.laps.map((l) => h('li', {}, fmtWatch(l)))) : null);
  }

  function editPanel() {
    const planner = getPlanner();
    let title = '';
    let url = '';
    return h('div', { class: 'dock-pop', role: 'dialog', 'aria-label': 'Edit dock' },
      h('p', { class: 'dock-title' }, 'Edit dock'),
      ...DOCK_APPS.filter(([k]) => k !== 'links').map(([k, label]) => h('label', { class: 'toggle' },
        h('span', { class: 'toggle-text' }, label),
        h('input', { type: 'checkbox', role: 'switch', checked: planner.dock.apps[k] !== false, onchange: (e) => plannerOp('setDockApp', { app: k, on: e.target.checked }) }))),
      h('p', { class: 'dock-sub' }, 'Pinned links'),
      planner.dock.links.length
        ? h('ul', { class: 'dock-links-edit' }, ...planner.dock.links.map((l) => h('li', {},
          h('span', {}, l.title),
          h('button', { class: 'icon-btn small', 'aria-label': `Remove ${l.title}`, title: 'Remove', onclick: () => plannerOp('deleteLink', { id: l.id }) }, '×'))))
        : h('p', { class: 'hint' }, 'Pin the sites you study on, like NPTEL or your college portal.'),
      h('form', {
        class: 'dock-add',
        onsubmit: async (e) => {
          e.preventDefault();
          if (await plannerOp('addLink', { title, url })) { e.target.reset(); title = ''; url = ''; toast('Link pinned'); }
        },
      },
      h('input', { class: 'text-input', type: 'text', placeholder: 'Name (optional)', maxlength: '40', 'aria-label': 'Link name', oninput: (e) => { title = e.target.value; } }),
      h('input', { class: 'text-input', type: 'text', placeholder: 'Web address', 'aria-label': 'Web address', oninput: (e) => { url = e.target.value; } }),
      h('button', { class: 'btn primary small', type: 'submit' }, 'Pin link')));
  }

  function toggle(app) {
    openApp = openApp === app ? null : app;
    render();
  }

  function render() {
    const planner = getPlanner();
    const apps = planner.dock.apps;
    if (openApp !== 'stopwatch') clearInterval(swTimer);
    const items = [];
    if (apps.calc !== false) items.push(h('button', { class: `dock-btn${openApp === 'calc' ? ' on' : ''}`, 'aria-expanded': String(openApp === 'calc'), onclick: () => toggle('calc') }, 'Calculator'));
    if (apps.stopwatch !== false) items.push(h('button', { class: `dock-btn${openApp === 'stopwatch' ? ' on' : ''}${sw.running ? ' live' : ''}`, 'aria-expanded': String(openApp === 'stopwatch'), onclick: () => toggle('stopwatch') }, sw.running ? `Stopwatch ${fmtWatch(swNow()).slice(0, 5)}` : 'Stopwatch'));
    for (const l of planner.dock.links) {
      items.push(h('a', { class: 'dock-btn link', href: l.url, title: l.url },
        h('span', { class: 'domain-badge', 'aria-hidden': 'true' }, l.title.charAt(0).toUpperCase()), l.title));
    }
    items.push(h('button', { class: `dock-btn ghost${openApp === 'edit' ? ' on' : ''}`, 'aria-expanded': String(openApp === 'edit'), 'aria-label': 'Edit dock', title: 'Edit dock', onclick: () => toggle('edit') }, 'Edit'));

    const pop = openApp === 'calc' ? calcPanel() : openApp === 'stopwatch' ? stopwatchPanel() : openApp === 'edit' ? editPanel() : null;
    root.replaceChildren(...(pop ? [pop] : []), h('div', { class: 'dock-bar' }, ...items));
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openApp) { openApp = null; render(); } });
  // A click inside the dock may re-render it and detach its own target, so ignore detached targets.
  document.addEventListener('click', (e) => { if (openApp && e.target.isConnected && !root.contains(e.target)) { openApp = null; render(); } });
  render();
  return { render };
}
