// Keyboard shortcut status. Chrome only grants an extension's suggested shortcut when that key
// is free (another extension may already use it), and an extension cannot set shortcuts itself.
// So Oris shows what Chrome actually assigned and links to chrome://extensions/shortcuts.

export const SHORTCUT_LABELS = {
  'toggle-timer': 'Start or pause the focus timer',
  'highlight-selection': 'Highlight selected text',
  'quick-note': 'Write a quick note',
};

export async function getShortcuts() {
  let cmds = [];
  try { cmds = await chrome.commands.getAll(); } catch { return []; }
  return cmds
    .filter((c) => SHORTCUT_LABELS[c.name])
    .map((c) => ({ name: c.name, label: SHORTCUT_LABELS[c.name], key: c.shortcut || '' }));
}

export function openShortcutSettings() {
  return chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

// Settings panel listing every shortcut and whether Chrome assigned it.
export function shortcutsPanel(ctx) {
  const { el } = ctx;
  const node = el('section', { class: 'panel' }, el('h2', {}, 'Keyboard shortcuts'), el('p', { class: 'hint' }, 'Checking…'));
  getShortcuts().then((list) => {
    const missing = list.filter((s) => !s.key).length;
    node.replaceChildren(
      el('h2', {}, 'Keyboard shortcuts'),
      el('ul', { class: 'shortcut-list' }, ...list.map((s) => el('li', {},
        el('span', {}, s.label),
        s.key ? el('kbd', {}, s.key) : el('span', { class: 'shortcut-missing' }, 'Not set')))),
      el('p', { class: 'hint' }, missing
        ? 'Chrome leaves a shortcut unset when another extension already uses that key. Set it yourself on Chrome’s shortcuts page.'
        : 'These work on any web page. Change them on Chrome’s shortcuts page.'),
      el('button', { class: `btn small${missing ? ' primary' : ''}`, onclick: () => openShortcutSettings() }, 'Set shortcuts in Chrome'),
      el('p', { class: 'hint' }, 'On the Oris New Tab page, Space, N, S, R, E and / also work once you click the page.'),
    );
  });
  return node;
}

// A one-line notice in the side panel when shortcuts are missing. Dismissal is remembered
// for that exact set of missing shortcuts, so a newly missing one shows the notice again.
export function shortcutNotice(ctx) {
  const { el } = ctx;
  const node = el('div', { class: 'notice', hidden: true, role: 'status' });
  getShortcuts().then((list) => {
    const missing = list.filter((s) => !s.key);
    if (!missing.length) return;
    const sig = missing.map((s) => s.name).sort().join(',');
    try { if (localStorage.getItem('oris:shortcut-notice') === sig) return; } catch { /* storage blocked */ }
    node.hidden = false;
    node.replaceChildren(
      el('p', {}, `${missing.length === 1 ? 'A shortcut isn’t' : `${missing.length} shortcuts aren’t`} set in Chrome: ${missing.map((s) => s.label.toLowerCase()).join(', ')}.`),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary small', onclick: () => openShortcutSettings() }, 'Set shortcuts'),
        el('button', {
          class: 'btn ghost small',
          onclick: () => { try { localStorage.setItem('oris:shortcut-notice', sig); } catch { /* ignore */ } node.hidden = true; },
        }, 'Dismiss')),
    );
  });
  return node;
}
