// Pieces shared by the Research views: project switcher, reading page text, clipboard, downloads.
import { extractFromTab, pageExtractor, isPdfUrl } from '../lib/extract.js';

export function activeProject(state) {
  const r = state.research;
  return r.projects.find((p) => p.id === r.activeProjectId) || r.projects[0];
}

export function projectSources(state) {
  const pid = activeProject(state).id;
  return state.research.sources.filter((s) => s.projectId === pid);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export const isWeb = (url) => /^https?:/i.test(url || '');

// Project switcher with inline "new", "rename" and "delete".
export function projectBar(ctx, { onChange } = {}) {
  const { el, state, research } = ctx;
  const wrap = el('div', { class: 'project-bar' });
  let mode = 'view'; // 'view' | 'new' | 'manage'
  let confirmDelete = false;

  function render() {
    const r = state.research;
    const active = activeProject(state);
    const counts = new Map();
    for (const s of r.sources) counts.set(s.projectId, (counts.get(s.projectId) || 0) + 1);

    if (mode === 'new' || mode === 'manage') {
      const input = el('input', {
        class: 'text-input', type: 'text', maxlength: '80', 'aria-label': mode === 'new' ? 'New project name' : 'Project name',
        placeholder: mode === 'new' ? 'e.g. Climate change essay' : '', value: mode === 'manage' ? active.name : '',
      });
      const submit = async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { input.focus(); return; }
        const ok = mode === 'new' ? await research('addProject', { name }) : await research('renameProject', { id: active.id, name });
        if (ok) { mode = 'view'; render(); onChange && onChange(); }
      };
      const del = mode === 'manage' ? el('button', {
        type: 'button', class: `btn small ${confirmDelete ? 'danger' : 'ghost'}`, disabled: r.projects.length === 1,
        title: r.projects.length === 1 ? 'You need at least one project' : null,
        onclick: async () => {
          if (!confirmDelete) { confirmDelete = true; render(); return; }
          if (await research('deleteProject', { id: active.id })) { confirmDelete = false; mode = 'view'; render(); onChange && onChange(); }
        },
      }, confirmDelete ? `Delete with ${counts.get(active.id) || 0} sources?` : 'Delete project') : null;
      wrap.replaceChildren(el('form', { class: 'project-form', onsubmit: submit },
        el('div', { class: 'add-row' }, input,
          el('button', { class: 'btn primary small', type: 'submit' }, mode === 'new' ? 'Create' : 'Rename'),
          el('button', { class: 'btn ghost small', type: 'button', onclick: () => { mode = 'view'; confirmDelete = false; render(); } }, 'Cancel')),
        del));
      input.focus();
      return;
    }

    const select = el('select', {
      class: 'text-input project-select', 'aria-label': 'Project',
      onchange: async (e) => { if (await research('setActiveProject', { id: e.target.value })) onChange && onChange(); },
    }, ...r.projects.map((p) => el('option', { value: p.id, selected: p.id === active.id }, `${p.name} (${counts.get(p.id) || 0})`)));
    wrap.replaceChildren(
      select,
      el('button', { class: 'btn small', onclick: () => { mode = 'new'; render(); } }, 'New'),
      el('button', { class: 'btn ghost small', onclick: () => { mode = 'manage'; confirmDelete = false; render(); } }, 'Edit'),
    );
  }

  render();
  return { node: wrap, render: () => { if (mode === 'view') render(); } };
}

// Text + metadata for a URL: from the open tab when possible, otherwise fetched.
export async function readPage({ url, tabId, title }) {
  if (isPdfUrl(url)) {
    let res;
    try { res = await fetch(url); } catch { throw new Error('Couldn’t download this PDF.'); }
    if (!res.ok) throw new Error(`Couldn’t download this PDF (error ${res.status}).`);
    const { pdfToText } = await import('../lib/pdf-text.js');
    const { text } = await pdfToText(res, { maxPages: 30 });
    if (text.replace(/\s/g, '').length < 100) throw new Error('This PDF has no selectable text, so it’s probably a scan.');
    return { meta: { title: title || decodeURIComponent(url.split('/').pop() || ''), type: 'pdf', authors: [] }, text: text.slice(0, 16000) };
  }
  if (tabId != null) return extractFromTab(tabId);
  let res;
  try { res = await fetch(url, { credentials: 'include' }); } catch { throw new Error('Couldn’t load this page. Open it in a tab and try again.'); }
  if (!res.ok) throw new Error(`Couldn’t load this page (error ${res.status}). Open it in a tab and try again.`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return pageExtractor(16000, doc);
}

// Copies rich text (keeps italics in Word/Docs) with a plain-text fallback.
export async function copyRich(html, text) {
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch { /* fall through */ }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function download(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSafe(name) {
  return String(name || 'oris').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'oris';
}

export function shortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Renders a citation's parts with real italics.
export function citationNode(el, parts) {
  return el('p', { class: 'citation' }, ...parts.map((p) => (p.italic ? el('i', {}, p.text) : p.text)));
}
