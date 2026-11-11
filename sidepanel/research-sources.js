import { normalizeUrl, HIGHLIGHT_COLORS, projectTags, cleanTags } from '../lib/research.js';
import { CITE_STYLES, formatCitation, citationText, citationHtml } from '../lib/cite.js';
import { summarize, SUMMARY_LENGTHS } from '../lib/summarize.js';
import { saveText } from '../lib/source-text.js';
import { isPdfUrl } from '../lib/extract.js';
import { projectBar, activeProject, projectSources, hostOf, isWeb, readPage, copyRich, shortDate, citationNode } from './research-common.js';

const COLOR_LABEL = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };

export function mount(root, ctx, params = {}) {
  const { el, state, research, activeTab, toast, saveSettings } = ctx;
  const bar = projectBar(ctx, { onChange: () => render() });
  const body = el('div');
  root.append(bar.node, body);

  let openId = params.id || null;
  let tab = null;
  let filter = '';
  let tagFilter = '';
  let researching = false; // "Research this page" running
  let lastCitation = null; // { parts } shown after "Research this page"
  let tagDraft = '';
  let busy = ''; // url key of the page being summarised
  let confirmDelete = false;
  let editing = false;
  const pending = new Map(); // urlKey -> summary for pages not saved yet
  const noteTimers = new Map();

  const sourceById = (id) => state.research.sources.find((s) => s.id === id);
  const savedForUrl = (url) => {
    const key = normalizeUrl(url);
    const pid = activeProject(state).id;
    const all = state.research.sources.filter((s) => s.urlKey === key);
    return all.find((s) => s.projectId === pid) || null;
  };

  async function refreshTab() {
    tab = await activeTab();
    if (!openId) render();
  }

  // ---------- actions ----------
  // Saves the page and keeps its text so Ask can search it. Returns { source, page }.
  async function savePage({ quiet } = {}) {
    if (!tab) return null;
    let page = null;
    let meta = { title: tab.title };
    try {
      page = await readPage({ url: tab.url, tabId: isPdfUrl(tab.url) ? null : tab.id, title: tab.title });
      meta = { ...page.meta, title: page.meta.title || tab.title };
    } catch { /* restricted page: keep the tab title */ }
    const source = await research('saveSource', { url: tab.url, meta });
    if (!source) return null;
    const patch = {};
    const summary = pending.get(normalizeUrl(tab.url));
    if (summary) patch.summary = summary;
    if (page && await saveText(source.id, page.text)) patch.hasText = true;
    if (Object.keys(patch).length) await research('updateSource', { id: source.id, patch });
    if (!quiet) toast(`Saved to “${activeProject(state).name}”`);
    return { source, page };
  }

  // One click: save the page, summarise it, and show its citation ready to copy.
  async function researchPage() {
    if (!tab || researching) return;
    researching = true;
    render();
    try {
      const res = await savePage({ quiet: true });
      if (!res) return;
      const { source, page } = res;
      if (page && page.text) {
        try {
          const { summary, warning } = await summarize(page.text, state.settings, page.meta.title || tab.title);
          if (warning) toast(`AI summary failed (${warning}). Showing key sentences instead.`, 'error');
          await research('updateSource', { id: source.id, patch: { summary } });
        } catch (err) { toast(err.message, 'error'); }
      }
      const fresh = sourceById(source.id) || source;
      const parts = formatCitation(fresh, state.settings.citeStyle || 'apa', 1);
      lastCitation = { id: source.id, parts: (state.settings.citeStyle === 'ieee' ? parts.slice(1) : parts) };
      toast(`Saved, summarised and cited in “${activeProject(state).name}”`);
    } finally {
      researching = false;
      render();
    }
  }

  async function runSummary({ url, tabId, title, sourceId }) {
    const key = normalizeUrl(url);
    busy = key;
    render();
    try {
      const page = await readPage({ url, tabId, title });
      const { summary, warning } = await summarize(page.text, state.settings, page.meta.title || title);
      if (warning) toast(`AI summary failed (${warning}). Showing key sentences instead.`, 'error');
      const target = sourceId ? sourceById(sourceId) : savedForUrl(url);
      if (target) {
        const patch = { summary };
        // Reading the page again is a chance to fill in text for Ask and a missing DOI.
        if (!target.hasText && await saveText(target.id, page.text)) patch.hasText = true;
        await research('updateSource', { id: target.id, patch });
      }
      else pending.set(key, { ...summary, at: Date.now() });
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      busy = '';
      render();
    }
  }

  async function openUrl(url) {
    if (tab && normalizeUrl(tab.url) === normalizeUrl(url)) return;
    await chrome.tabs.create({ url });
  }

  async function showHighlight(source, h) {
    const t = await activeTab();
    if (t && normalizeUrl(t.url) === source.urlKey) {
      const res = await chrome.runtime.sendMessage({ type: 'research:scrollTo', tabId: t.id, url: t.url, id: h.id });
      if (!res || !res.ok || !res.result) toast('This highlight isn’t on the page right now. The page may have changed.', 'error');
    } else {
      await chrome.tabs.create({ url: source.url });
      toast('Opened the page. Your highlights appear once it loads.');
    }
  }

  function saveNoteLater(fn, key) {
    const prev = noteTimers.get(key);
    if (prev) clearTimeout(prev.t);
    noteTimers.set(key, { fn, t: setTimeout(() => { noteTimers.delete(key); fn(); }, 600) });
  }
  function flushNotes() {
    for (const [key, { fn, t }] of noteTimers) { clearTimeout(t); noteTimers.delete(key); fn(); }
  }

  // ---------- pieces ----------
  // TL;DR / Standard / Detailed, remembered for next time.
  function lengthPicker() {
    const cur = state.settings.summaryLength || 'standard';
    return el('div', { class: 'segmented small-seg', role: 'radiogroup', 'aria-label': 'Summary length' },
      ...SUMMARY_LENGTHS.map(([v, label]) => el('button', { role: 'radio', 'aria-checked': String(v === cur), onclick: () => saveSettings({ summaryLength: v }) }, label)));
  }

  function summaryBlock(summary) {
    if (!summary) return null;
    const lengthName = (SUMMARY_LENGTHS.find(([v]) => v === summary.length) || [, ''])[1];
    return el('div', { class: 'summary' },
      el('p', { class: 'summary-label' }, summary.method === 'ai' ? `AI summary${lengthName && lengthName !== 'Standard' ? `, ${lengthName}` : ''}` : 'Key sentences (turn on Oris AI in Settings for an AI summary)'),
      summary.text ? el('p', {}, summary.text) : null,
      summary.points && summary.points.length ? el('ul', {}, ...summary.points.map((p) => el('li', {}, p))) : null);
  }

  function currentPageCard() {
    if (!tab || !isWeb(tab.url)) {
      return el('section', { class: 'panel current muted' },
        el('p', { class: 'hint' }, 'Open a web page or online PDF to save it, summarise it or highlight it.'));
    }
    const saved = savedForUrl(tab.url);
    const key = normalizeUrl(tab.url);
    const summary = (saved && saved.summary) || pending.get(key);
    const isBusy = busy === key || researching;
    const cite = lastCitation && saved && lastCitation.id === saved.id ? lastCitation : null;
    return el('section', { class: 'panel current' },
      el('p', { class: 'current-label' }, 'This page'),
      el('p', { class: 'current-title' }, tab.title || tab.url),
      el('p', { class: 'current-host' }, hostOf(tab.url), saved ? el('span', { class: 'saved-pill' }, 'Saved') : null),
      el('div', { class: 'row' },
        saved
          ? el('button', { class: 'btn small', onclick: () => { openId = saved.id; render(); } }, 'Open in Oris')
          : el('button', { class: 'btn primary small', disabled: isBusy, onclick: researchPage, title: 'Save, summarise and cite in one click' }, researching ? 'Researching…' : 'Research this page'),
        saved ? null : el('button', { class: 'btn small', disabled: isBusy, onclick: () => savePage() }, 'Save only'),
        el('button', { class: 'btn small', disabled: isBusy, onclick: () => runSummary({ url: tab.url, tabId: isPdfUrl(tab.url) ? null : tab.id, title: tab.title }) },
          busy === key ? 'Summarising…' : summary ? 'Summarise again' : 'Summarise')),
      lengthPicker(),
      summaryBlock(summary),
      cite ? el('div', { class: 'cite-ready' },
        el('p', { class: 'summary-label' }, 'Citation'),
        citationNode(el, cite.parts),
        el('button', {
          class: 'btn small', onclick: async () => toast((await copyRich(citationHtml(cite.parts), citationText(cite.parts))) ? 'Citation copied' : 'Couldn’t copy. Select the text and copy it instead.'),
        }, 'Copy citation')) : null,
      el('p', { class: 'hint tip' }, 'To highlight, select text on the page, then right-click and choose “Highlight with Oris”, or press Alt+Shift+H.'),
    );
  }

  function listView() {
    const all = projectSources(state);
    const parts = [currentPageCard()];
    parts.push(el('div', { class: 'section-head' }, el('h2', {}, `Sources (${all.length})`)));
    if (all.length > 4) {
      parts.push(el('input', {
        class: 'text-input filter', type: 'search', placeholder: 'Search sources, notes and highlights', value: filter, 'aria-label': 'Search sources',
        oninput: (e) => { filter = e.target.value; renderList(); },
      }));
    }
    const tags = projectTags(state.research, activeProject(state).id);
    if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
    if (tags.length) {
      parts.push(el('div', { class: 'chips tag-filter', role: 'group', 'aria-label': 'Filter by tag' },
        el('button', { class: 'chip', 'aria-pressed': String(!tagFilter), onclick: () => { tagFilter = ''; render(); } }, 'All'),
        ...tags.map((t) => el('button', { class: 'chip', 'aria-pressed': String(tagFilter === t), onclick: () => { tagFilter = tagFilter === t ? '' : t; render(); } }, `#${t}`))));
    }
    const listNode = el('div', { class: 'source-list' });
    const renderList = () => {
      const qq = filter.trim().toLowerCase();
      const pool = tagFilter ? all.filter((s) => (s.tags || []).includes(tagFilter)) : all;
      const items = qq ? pool.filter((s) => [s.title, s.siteName, s.url, s.notes, ...(s.tags || []), ...s.highlights.map((h) => h.text)].join(' ').toLowerCase().includes(qq)) : pool;
      listNode.replaceChildren(...(items.length ? items.map((s) => el('button', { class: 'source-card', onclick: () => { openId = s.id; confirmDelete = false; editing = false; render(); } },
        el('span', { class: 'source-title' }, s.title),
        el('span', { class: 'source-meta' }, [s.siteName || hostOf(s.url), s.highlights.length ? `${s.highlights.length} highlight${s.highlights.length === 1 ? '' : 's'}` : null, `saved ${shortDate(s.savedAt)}`].filter(Boolean).join(', ')),
        (s.tags || []).length ? el('span', { class: 'source-tags' }, ...(s.tags.map((t) => el('span', { class: 'tag' }, `#${t}`)))) : null,
      )) : [el('p', { class: 'empty' }, all.length ? 'No sources match.' : 'No sources in this project yet. Save the page you’re reading, or highlight something on it.')]));
    };
    renderList();
    parts.push(listNode);
    return parts;
  }

  function highlightItem(source, h) {
    return el('li', { class: 'hl', dataset: { color: h.color } },
      el('blockquote', {}, h.text),
      el('input', {
        class: 'text-input hl-note', type: 'text', placeholder: 'Add a note', value: h.note || '', 'aria-label': 'Note for this highlight',
        oninput: (e) => saveNoteLater(() => research('updateHighlight', { sourceId: source.id, id: h.id, patch: { note: e.target.value } }), h.id),
      }),
      el('div', { class: 'hl-actions' },
        el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Highlight colour' },
          ...HIGHLIGHT_COLORS.map((c) => el('button', {
            class: 'swatch', role: 'radio', 'aria-checked': String(c === h.color), 'aria-label': COLOR_LABEL[c], title: COLOR_LABEL[c], dataset: { color: c },
            onclick: () => research('updateHighlight', { sourceId: source.id, id: h.id, patch: { color: c } }),
          }))),
        el('button', { class: 'btn ghost small', onclick: () => showHighlight(source, h) }, 'Show on page'),
        el('button', { class: 'icon-btn small', 'aria-label': 'Delete highlight', title: 'Delete highlight', onclick: () => research('deleteHighlight', { sourceId: source.id, id: h.id }) }, '×'),
      ));
  }

  function citationSection(source) {
    const style = state.settings.citeStyle || 'apa';
    const parts = formatCitation(source, style, 1);
    const section = el('section', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h2', {}, 'Citation'),
        el('button', { class: 'btn ghost small', onclick: () => { editing = !editing; render(); } }, editing ? 'Close' : 'Edit details')),
      el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Citation style' },
        ...CITE_STYLES.map(([v, label]) => el('button', { role: 'radio', 'aria-checked': String(v === style), onclick: () => saveSettings({ citeStyle: v }) }, label))),
      citationNode(el, style === 'ieee' ? parts.slice(1) : parts),
      el('button', {
        class: 'btn small', onclick: async () => {
          const p = style === 'ieee' ? parts.slice(1) : parts;
          toast((await copyRich(citationHtml(p), citationText(p))) ? 'Citation copied' : 'Couldn’t copy. Select the text and copy it instead.', '');
        },
      }, 'Copy citation'),
    );
    if (!source.authors.length || !source.published) {
      section.append(el('p', { class: 'hint' }, `Missing ${[!source.authors.length && 'author', !source.published && 'date'].filter(Boolean).join(' and ')}. Add it with “Edit details” if the page shows one.`));
    }
    if (editing) {
      const f = {
        title: el('input', { class: 'text-input', value: source.title }),
        authors: el('textarea', { class: 'text-input', rows: '3', placeholder: 'One per line, e.g. Ravi Kumar Sharma' }, source.authors.join('\n')),
        published: el('input', { class: 'text-input', value: source.published, placeholder: 'YYYY-MM-DD, YYYY-MM or YYYY' }),
        siteName: el('input', { class: 'text-input', value: source.siteName, placeholder: hostOf(source.url) }),
        publisher: el('input', { class: 'text-input', value: source.publisher }),
        doi: el('input', { class: 'text-input', value: source.doi || '', placeholder: '10.xxxx/… (journal articles)' }),
      };
      const field = (label, node, hint) => el('label', { class: 'field' }, el('span', {}, label), node, hint ? el('small', {}, hint) : null);
      section.append(el('form', {
        class: 'cite-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const ok = await research('updateSource', { id: source.id, patch: {
            title: f.title.value.trim() || source.title,
            authors: f.authors.value.split('\n').map((a) => a.trim()).filter(Boolean),
            published: f.published.value.trim(),
            siteName: f.siteName.value.trim(),
            publisher: f.publisher.value.trim(),
            doi: f.doi.value.trim(),
          } });
          if (ok) { editing = false; render(); toast('Details saved'); }
        },
      },
      field('Title', f.title),
      field('Authors', f.authors, 'For an organisation, write its full name.'),
      field('Published', f.published),
      field('Website or journal', f.siteName),
      field('Publisher', f.publisher, 'Leave empty if it’s the same as the website.'),
      field('DOI', f.doi, 'When a source has a DOI, citations link to it instead of the page address.'),
      el('button', { class: 'btn primary', type: 'submit' }, 'Save details')));
    }
    return section;
  }

  function tagEditor(s) {
    const tags = s.tags || [];
    const suggestions = projectTags(state.research, s.projectId).filter((t) => !tags.includes(t)).slice(0, 6);
    const input = el('input', {
      class: 'tag-input', type: 'text', maxlength: '30', placeholder: tags.length ? 'Add tag' : 'Add a tag, e.g. methods', value: tagDraft,
      'aria-label': 'Add a tag', list: 'tag-suggest',
      oninput: (e) => { tagDraft = e.target.value; },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const next = cleanTags([...tags, ...tagDraft.split(',')]);
          tagDraft = '';
          input.value = '';
          if (next.length !== tags.length) research('updateSource', { id: s.id, patch: { tags: next } });
        }
      },
    });
    return el('div', { class: 'tag-editor' },
      ...tags.map((t) => el('span', { class: 'tag' }, `#${t}`,
        el('button', { class: 'tag-x', 'aria-label': `Remove tag ${t}`, title: 'Remove tag', onclick: () => research('updateSource', { id: s.id, patch: { tags: tags.filter((x) => x !== t) } }) }, '×'))),
      input,
      el('datalist', { id: 'tag-suggest' }, ...suggestions.map((t) => el('option', { value: t }))));
  }

  function detailView() {
    const s = sourceById(openId);
    if (!s) { openId = null; return listView(); }
    const isBusy = busy === s.urlKey;
    const tabIsThis = tab && normalizeUrl(tab.url) === s.urlKey;
    const projects = state.research.projects;

    return [
      el('div', { class: 'section-head' },
        el('button', { class: 'btn ghost small back', onclick: () => { openId = null; render(); } }, '‹ Sources'),
        el('button', {
          class: `btn small ${confirmDelete ? 'danger' : 'ghost'}`,
          onclick: async () => {
            if (!confirmDelete) { confirmDelete = true; render(); return; }
            if (await research('deleteSource', { id: s.id })) { openId = null; confirmDelete = false; render(); toast('Source deleted'); }
          },
        }, confirmDelete ? 'Tap again to delete' : 'Delete')),

      el('section', { class: 'panel source-head' },
        el('h2', {}, s.title),
        el('p', { class: 'current-host' }, s.siteName || hostOf(s.url), s.type === 'pdf' ? el('span', { class: 'saved-pill' }, 'PDF') : null,
          s.doi ? el('a', { class: 'doi-link', href: `https://doi.org/${s.doi}`, target: '_blank', rel: 'noopener' }, `DOI ${s.doi}`) : null),
        tagEditor(s),
        el('div', { class: 'row' },
          tabIsThis ? null : el('button', { class: 'btn small', onclick: () => openUrl(s.url) }, 'Open page'),
          el('button', { class: 'btn small', disabled: isBusy, onclick: () => runSummary({ url: s.url, tabId: tabIsThis && !isPdfUrl(s.url) ? tab.id : null, title: s.title, sourceId: s.id }) },
            isBusy ? 'Summarising…' : s.summary ? 'Summarise again' : 'Summarise')),
        lengthPicker(),
        summaryBlock(s.summary),
        projects.length > 1 ? el('label', { class: 'field move' }, el('span', {}, 'Project'),
          el('select', {
            class: 'text-input',
            onchange: async (e) => { if (await research('updateSource', { id: s.id, patch: { projectId: e.target.value } })) { toast('Moved'); openId = null; render(); } },
          }, ...projects.map((p) => el('option', { value: p.id, selected: p.id === s.projectId }, p.name)))) : null,
      ),

      el('section', { class: 'panel' },
        el('h2', {}, `Highlights (${s.highlights.length})`),
        s.highlights.length
          ? el('ul', { class: 'hl-list' }, ...s.highlights.map((h) => highlightItem(s, h)))
          : el('p', { class: 'empty' }, 'No highlights yet. Open the page, select text, then right-click and choose “Highlight with Oris”.')),

      el('section', { class: 'panel' },
        el('label', { class: 'field notes' }, el('span', {}, 'Notes'),
          el('textarea', {
            class: 'text-input', rows: '5', placeholder: 'Your thoughts, quotes to use, questions to follow up…',
            oninput: (e) => saveNoteLater(() => research('updateSource', { id: s.id, patch: { notes: e.target.value } }), s.id),
          }, s.notes || ''))),

      citationSection(s),
    ];
  }

  // Don't rebuild while the person is typing in a field: it would drop the cursor.
  // Catch up when they leave the field instead.
  let stale = false;
  body.addEventListener('focusout', () => setTimeout(() => {
    if (stale && !body.contains(document.activeElement)) render();
  }, 0));

  function render() {
    const a = document.activeElement;
    // An empty tag box (a tag was just added) may re-render; the cursor goes back into it.
    const refocusTag = a && body.contains(a) && a.matches('.tag-input') && !a.value;
    if (!refocusTag && a && body.contains(a) && a.matches('textarea, input[type="text"], input[type="search"]')) { stale = true; return; }
    stale = false;
    const y = window.scrollY;
    body.replaceChildren(...(openId ? detailView() : listView()));
    if (openId) window.scrollTo(0, y);
    if (refocusTag) { const t = body.querySelector('.tag-input'); if (t) t.focus(); }
  }

  refreshTab();
  render();

  return {
    update(changed) {
      if (changed.tab) { refreshTab(); return; }
      if (changed.research) { bar.render(); render(); }
      if (changed.settings) render();
    },
    unmount() {
      flushNotes();
    },
  };
}
