import { projectBar, activeProject, hostOf, isWeb } from './research-common.js';

export function mount(root, ctx) {
  const { el, state, research, toast } = ctx;
  const bar = projectBar(ctx, { onChange: () => render() });
  const body = el('div');
  root.append(bar.node, body);

  let name = '';
  let closeAfter = false;
  const expanded = new Set();
  const confirmDelete = new Set();
  let renaming = null;

  async function windowTabs() {
    const win = await chrome.windows.getCurrent();
    return (await chrome.tabs.query({ windowId: win.id })).filter((t) => isWeb(t.url));
  }

  async function save(e) {
    e.preventDefault();
    const tabs = await windowTabs();
    if (!tabs.length) { toast('No web pages are open in this window.', 'error'); return; }
    const label = name.trim() || `Session, ${new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
    const session = await research('saveSession', { name: label, tabs: tabs.map((t) => ({ url: t.url, title: t.title })) });
    if (!session) return;
    name = '';
    if (closeAfter) {
      // Keep the window open: replace the last tab with a new tab page, close the rest.
      await chrome.tabs.create({ windowId: tabs[0].windowId });
      await chrome.tabs.remove(tabs.map((t) => t.id));
    }
    toast(`Saved ${session.tabs.length} tab${session.tabs.length === 1 ? '' : 's'}${closeAfter ? ' and closed them' : ''}`);
    render();
  }

  async function restore(s, newWindow) {
    const urls = s.tabs.map((t) => t.url);
    if (newWindow) await chrome.windows.create({ url: urls, focused: true });
    else {
      const win = await chrome.windows.getCurrent();
      for (const url of urls) await chrome.tabs.create({ windowId: win.id, url, active: false });
    }
    toast(`Opened ${urls.length} tab${urls.length === 1 ? '' : 's'}`);
  }

  function sessionCard(s) {
    const open = expanded.has(s.id);
    const head = renaming === s.id
      ? el('form', {
        class: 'add-row compact',
        onsubmit: async (e) => {
          e.preventDefault();
          if (await research('renameSession', { id: s.id, name: e.target.elements[0].value })) { renaming = null; render(); }
        },
      }, el('input', { class: 'text-input', value: s.name, 'aria-label': 'Session name', maxlength: '80' }),
      el('button', { class: 'btn small primary', type: 'submit' }, 'Rename'),
      el('button', { class: 'btn small ghost', type: 'button', onclick: () => { renaming = null; render(); } }, 'Cancel'))
      : el('div', { class: 'session-head' },
        el('span', { class: 'session-name' }, s.name),
        el('span', { class: 'source-meta' }, `${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}, ${new Date(s.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`));

    return el('li', { class: 'session' },
      head,
      el('div', { class: 'row' },
        el('button', { class: 'btn primary small', onclick: () => restore(s, true) }, 'Open in new window'),
        el('button', { class: 'btn small', onclick: () => restore(s, false) }, 'Open here'),
        el('button', { class: 'btn ghost small', 'aria-expanded': String(open), onclick: () => { if (open) expanded.delete(s.id); else expanded.add(s.id); render(); } }, open ? 'Hide tabs' : 'Show tabs'),
      ),
      open ? el('ul', { class: 'session-tabs' }, ...s.tabs.map((t) => el('li', {},
        el('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.title || t.url),
        el('span', {}, hostOf(t.url))))) : null,
      open ? el('div', { class: 'row end' },
        el('button', { class: 'btn ghost small', onclick: () => { renaming = s.id; render(); } }, 'Rename'),
        el('button', {
          class: `btn small ${confirmDelete.has(s.id) ? 'danger' : 'ghost'}`,
          onclick: async () => {
            if (!confirmDelete.has(s.id)) { confirmDelete.add(s.id); render(); return; }
            await research('deleteSession', { id: s.id });
          },
        }, confirmDelete.has(s.id) ? 'Tap again to delete' : 'Delete')) : null,
    );
  }

  function render() {
    if (body.contains(document.activeElement) && document.activeElement.matches('input[type="text"]')) return;
    const pid = activeProject(state).id;
    const sessions = state.research.sessions.filter((s) => s.projectId === pid);
    body.replaceChildren(
      el('form', { class: 'panel', onsubmit: save },
        el('h2', {}, 'Save open tabs'),
        el('p', { class: 'hint' }, 'Keep every tab in this window as a session, and reopen them all later in one click.'),
        el('label', { class: 'field' }, el('span', {}, 'Session name'),
          el('input', { class: 'text-input', type: 'text', maxlength: '80', value: name, placeholder: 'e.g. Literature review, part 1', oninput: (e) => { name = e.target.value; } })),
        el('label', { class: 'toggle' },
          el('span', { class: 'toggle-text' }, 'Close the tabs after saving', el('small', {}, 'Frees up memory. You can reopen them any time.')),
          el('input', { type: 'checkbox', role: 'switch', checked: closeAfter, onchange: (e) => { closeAfter = e.target.checked; } })),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save tabs')),
      el('div', { class: 'section-head' }, el('h2', {}, `Sessions (${sessions.length})`)),
      sessions.length
        ? el('ul', { class: 'session-list' }, ...sessions.map(sessionCard))
        : el('p', { class: 'empty' }, 'No saved sessions in this project yet.'),
    );
  }

  render();
  body.addEventListener('focusout', () => setTimeout(() => { if (!body.contains(document.activeElement)) render(); }, 0));
  return { update(changed) { if (changed.research) { bar.render(); render(); } } };
}
